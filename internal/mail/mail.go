// Package mail hands a message to a relay an operator already has.
//
// It opens the socket; internal/store decides what the relay is. Nothing in the store touches
// the network and nothing here touches the database.
package mail

import (
	"crypto/tls"
	"errors"
	"fmt"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"time"
)

// Timeout bounds one send, because it happens while a request is open.
const Timeout = 30 * time.Second

// tlsConfig is how the connection is secured, as a var so a test can hold a real conversation
// with a server on a loopback port rather than mocking net/smtp.
//
// A mock would assert that net/smtp was called. What is worth asserting is that STARTTLS is
// demanded, that the password never crosses before the upgrade, and that a relay's own refusal
// comes back attached.
var tlsConfig = func(host string) *tls.Config { return &tls.Config{ServerName: host} }

// SetTLSConfig replaces it and returns the function that puts the old one back, so a test
// restores it with defer rather than remembering to.
func SetTLSConfig(f func(host string) *tls.Config) func() {
	previous := tlsConfig
	tlsConfig = f
	return func() { tlsConfig = previous }
}

// Relay is where to hand a message over.
type Relay struct {
	Host        string
	Port        int
	Implicit    bool
	Username    string
	Password    string
	FromAddress string
	FromName    string
}

// Message is what to send.
type Message struct {
	To      string
	Subject string
	Body    string
}

// Send delivers one, and returns the relay's own words when it refuses.
//
// Nothing is queued: a message goes out while the request that asked for it is still open, so
// the caller learns whether the relay accepted it. A recovery code that failed silently is
// worse than one that failed loudly.
func Send(relay Relay, msg Message) error {
	addr := net.JoinHostPort(relay.Host, fmt.Sprint(relay.Port))
	conn, err := net.DialTimeout("tcp", addr, Timeout)
	if err != nil {
		return fmt.Errorf("could not reach %s: %w", addr, err)
	}
	conn.SetDeadline(time.Now().Add(Timeout))

	if relay.Implicit {
		conn = tls.Client(conn, tlsConfig(relay.Host))
	}

	client, err := smtp.NewClient(conn, relay.Host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("could not start a conversation with %s: %w", relay.Host, err)
	}
	defer client.Close()

	if !relay.Implicit {
		ok, _ := client.Extension("STARTTLS")
		if !ok {
			// Refused by name rather than fallen back from, and the sentence says what is
			// usually wrong.
			return errors.New("that relay does not offer STARTTLS; try implicit TLS on port 465")
		}
		if err := client.StartTLS(tlsConfig(relay.Host)); err != nil {
			return fmt.Errorf("the certificate did not verify: %w", err)
		}
	}

	if relay.Username != "" {
		// Chosen from what EHLO advertised rather than tried and retried.
		//
		// net/smtp quits the connection when an AUTH attempt fails, so a second Auth on the
		// same client cannot work: a try-PLAIN-then-LOGIN fallback would fail against every
		// relay that speaks only LOGIN, which is the case it existed for.
		auth, err := mechanism(client, relay)
		if err != nil {
			return err
		}
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("the credentials were rejected: %w", err)
		}
	}

	if err := client.Mail(relay.FromAddress); err != nil {
		return fmt.Errorf("the relay refused the sender: %w", err)
	}
	if err := client.Rcpt(msg.To); err != nil {
		return fmt.Errorf("the relay refused the recipient: %w", err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("the relay refused the message: %w", err)
	}
	if _, err := w.Write(compose(relay, msg)); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("the relay refused the message: %w", err)
	}
	return client.Quit()
}

// mechanism picks one the relay offers.
//
// LOGIN is the same credentials in a sillier shape, and enough relays speak nothing else that
// refusing it would mean refusing to send at all.
func mechanism(client *smtp.Client, relay Relay) (smtp.Auth, error) {
	_, offered := client.Extension("AUTH")
	upper := strings.ToUpper(offered)
	switch {
	case strings.Contains(upper, "PLAIN"):
		return smtp.PlainAuth("", relay.Username, relay.Password, relay.Host), nil
	case strings.Contains(upper, "LOGIN"):
		return loginAuth{relay.Username, relay.Password, relay.Host}, nil
	}
	if offered == "" {
		return nil, errors.New("that relay asks for no authentication, but a username was given")
	}
	return nil, fmt.Errorf("that relay offers only %s, which this does not speak", offered)
}

// compose builds the message.
//
// By hand rather than with a library: it is a dozen headers and a quoted-printable body.
// Addresses go through net/mail, because a display name needs quoting when it holds a comma and
// encoding when it holds anything outside ASCII, and either done by hand produces a header that
// parses as a different address than the one meant.
func compose(relay Relay, msg Message) []byte {
	from := (&mail.Address{Name: relay.FromName, Address: relay.FromAddress}).String()
	to := (&mail.Address{Address: msg.To}).String()

	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\n", from)
	fmt.Fprintf(&b, "To: %s\r\n", to)
	fmt.Fprintf(&b, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", msg.Subject))
	fmt.Fprintf(&b, "Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z))
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n")
	b.WriteString("\r\n")
	b.WriteString(strings.ReplaceAll(msg.Body, "\n", "\r\n"))
	return []byte(b.String())
}

// loginAuth is LOGIN, which net/smtp does not carry.
//
// It refuses to run over an unencrypted connection or against a host that is not the one
// configured, which is the whole reason it is written out rather than inlined.
type loginAuth struct{ username, password, host string }

func (a loginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if !server.TLS {
		return "", nil, errors.New("refusing to send a password over an unencrypted connection")
	}
	if server.Name != a.host {
		return "", nil, errors.New("refusing to send a password to a different host")
	}
	return "LOGIN", nil, nil
}

func (a loginAuth) Next(fromServer []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	switch strings.ToLower(strings.TrimSpace(string(fromServer))) {
	case "username:":
		return []byte(a.username), nil
	case "password:":
		return []byte(a.password), nil
	}
	return nil, fmt.Errorf("unexpected challenge from the relay: %q", fromServer)
}
