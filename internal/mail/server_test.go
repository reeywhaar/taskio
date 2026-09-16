package mail

import (
	"bufio"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// relayServer is a real SMTP server on a loopback port.
//
// Enough of RFC 5321 to hold the conversation net/smtp has, and no more. Everything it saw is
// recorded, which is what lets a test assert where the password did and did not appear.
type relayServer struct {
	t        *testing.T
	listener net.Listener
	cert     tls.Certificate
	roots    *x509.CertPool

	// offerStartTLS is off for the relay that does not, which has to be refused by name.
	offerStartTLS bool
	// implicit wraps the connection from the first byte.
	implicit bool
	// authMethods is what EHLO advertises.
	authMethods string
	// rejectData is the 550 a relay gives back, which has to reach the caller.
	rejectData string

	mu sync.Mutex
	// plaintext is every line read before the connection was secured.
	plaintext []string
	// secure is every line read after.
	secure []string
	// body is what arrived after DATA.
	body string
}

func newRelay(t *testing.T) *relayServer {
	t.Helper()
	cert, roots := selfSigned(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s := &relayServer{
		t:             t,
		listener:      listener,
		cert:          cert,
		roots:         roots,
		offerStartTLS: true,
		authMethods:   "PLAIN LOGIN",
	}
	t.Cleanup(func() { listener.Close() })
	go s.accept()
	return s
}

func (s *relayServer) port() int { return s.listener.Addr().(*net.TCPAddr).Port }

// relay is what Send is handed: the host is the name in the certificate.
func (s *relayServer) relay() Relay {
	return Relay{
		Host:        "localhost",
		Port:        s.port(),
		Implicit:    s.implicit,
		FromAddress: "taskio@example.com",
		FromName:    "taskio",
	}
}

// trust points the sender at this server's certificate for the length of one test.
func (s *relayServer) trust() func() {
	return SetTLSConfig(func(host string) *tls.Config {
		return &tls.Config{ServerName: host, RootCAs: s.roots}
	})
}

func (s *relayServer) accept() {
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			return
		}
		go s.serve(conn)
	}
}

func (s *relayServer) serve(conn net.Conn) {
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(10 * time.Second))

	secured := false
	if s.implicit {
		tlsConn := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{s.cert}})
		if err := tlsConn.Handshake(); err != nil {
			return
		}
		conn = tlsConn
		secured = true
	}

	r := bufio.NewReader(conn)
	write := func(format string, a ...any) {
		fmt.Fprintf(conn, format+"\r\n", a...)
	}
	write("220 localhost ESMTP")

	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		s.record(secured, line)

		verb, rest, _ := strings.Cut(line, " ")
		switch strings.ToUpper(verb) {
		case "EHLO", "HELO":
			write("250-localhost")
			if s.offerStartTLS && !secured {
				write("250-STARTTLS")
			}
			if secured && s.authMethods != "" {
				write("250-AUTH %s", s.authMethods)
			}
			write("250 OK")

		case "STARTTLS":
			if !s.offerStartTLS {
				write("502 not implemented")
				continue
			}
			write("220 go ahead")
			tlsConn := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{s.cert}})
			if err := tlsConn.Handshake(); err != nil {
				return
			}
			conn = tlsConn
			r = bufio.NewReader(conn)
			secured = true
			write = func(format string, a ...any) { fmt.Fprintf(conn, format+"\r\n", a...) }

		case "AUTH":
			method, arg, _ := strings.Cut(rest, " ")
			switch strings.ToUpper(method) {
			case "PLAIN":
				if !strings.Contains(s.authMethods, "PLAIN") {
					write("504 unrecognised")
					continue
				}
				_ = arg
				write("235 authenticated")
			case "LOGIN":
				write("334 %s", base64.StdEncoding.EncodeToString([]byte("Username:")))
				user, _ := r.ReadString('\n')
				s.record(secured, strings.TrimRight(user, "\r\n"))
				write("334 %s", base64.StdEncoding.EncodeToString([]byte("Password:")))
				pass, _ := r.ReadString('\n')
				s.record(secured, strings.TrimRight(pass, "\r\n"))
				write("235 authenticated")
			default:
				write("504 unrecognised")
			}

		case "MAIL", "RCPT":
			write("250 OK")

		case "DATA":
			if s.rejectData != "" {
				write("%s", s.rejectData)
				continue
			}
			write("354 go ahead")
			var body strings.Builder
			for {
				dataLine, err := r.ReadString('\n')
				if err != nil {
					return
				}
				if strings.TrimRight(dataLine, "\r\n") == "." {
					break
				}
				body.WriteString(dataLine)
			}
			s.mu.Lock()
			s.body = body.String()
			s.mu.Unlock()
			write("250 queued")

		case "QUIT":
			write("221 bye")
			return

		default:
			write("500 unrecognised")
		}
	}
}

func (s *relayServer) record(secured bool, line string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if secured {
		s.secure = append(s.secure, line)
	} else {
		s.plaintext = append(s.plaintext, line)
	}
}

func (s *relayServer) saw() (plaintext, secure []string, body string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.plaintext...), append([]string(nil), s.secure...), s.body
}

// selfSigned makes a certificate for localhost, so the handshake is a real one.
func selfSigned(t *testing.T) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "localhost"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:              []string{"localhost"},
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1")},
		IsCA:                  true,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})

	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM(certPEM)
	return cert, roots
}
