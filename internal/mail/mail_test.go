package mail

import (
	"strings"
	"testing"
)

func message() Message {
	return Message{To: "misha@example.com", Subject: "taskio test", Body: "Hello.\n"}
}

// A real conversation, so what is asserted is that the upgrade happens rather than that
// net/smtp was called.
func TestSTARTTLSIsDemandedAndTheUpgradeHappens(t *testing.T) {
	relay := newRelay(t)
	defer relay.trust()()

	if err := Send(relay.relay(), message()); err != nil {
		t.Fatal(err)
	}

	plaintext, secure, body := relay.saw()
	if !contains(plaintext, "STARTTLS") {
		t.Errorf("STARTTLS was never asked for: %v", plaintext)
	}
	// Everything that matters happened after the upgrade.
	for _, verb := range []string{"MAIL", "RCPT", "DATA"} {
		if hasPrefix(plaintext, verb) {
			t.Errorf("%s crossed in the clear", verb)
		}
		if !hasPrefix(secure, verb) {
			t.Errorf("%s never arrived: %v", verb, secure)
		}
	}
	if !strings.Contains(body, "Hello.") {
		t.Errorf("body = %q", body)
	}
}

// Refused by name rather than fallen back from: a password crossing the network in the clear is
// not a choice somebody should be able to make by accident.
func TestARelayWithoutSTARTTLSIsRefusedByName(t *testing.T) {
	relay := newRelay(t)
	relay.offerStartTLS = false
	defer relay.trust()()

	err := Send(relay.relay(), message())
	if err == nil {
		t.Fatal("a plaintext relay was used")
	}
	// The sentence says what is usually wrong, because "sending failed" sends somebody
	// through the wrong afternoon.
	if !strings.Contains(err.Error(), "STARTTLS") || !strings.Contains(err.Error(), "465") {
		t.Errorf("the refusal does not say what to do: %q", err)
	}

	plaintext, _, _ := relay.saw()
	if hasPrefix(plaintext, "MAIL") {
		t.Error("it sent anyway")
	}
}

// The assertion the whole harness exists for.
func TestThePasswordNeverCrossesBeforeTheUpgrade(t *testing.T) {
	relay := newRelay(t)
	defer relay.trust()()

	r := relay.relay()
	r.Username = "misha"
	r.Password = "hunter2-a-very-distinctive-string"

	if err := Send(r, message()); err != nil {
		t.Fatal(err)
	}

	plaintext, secure, _ := relay.saw()
	for _, line := range plaintext {
		if strings.Contains(line, "hunter2") {
			t.Fatalf("the password crossed in the clear: %q", line)
		}
		// Base64 of the PLAIN payload would not contain the word literally either.
		if strings.Contains(line, "AUTH") {
			t.Fatalf("authentication was attempted before the upgrade: %q", line)
		}
	}
	if !hasPrefix(secure, "AUTH") {
		t.Errorf("it never authenticated: %v", secure)
	}
}

// LOGIN is the same credentials in a sillier shape, and enough relays speak nothing else that
// refusing it would mean refusing to send.
func TestLOGINIsUsedWhenPLAINIsNotOffered(t *testing.T) {
	relay := newRelay(t)
	relay.authMethods = "LOGIN"
	defer relay.trust()()

	r := relay.relay()
	r.Username = "misha"
	r.Password = "hunter2"

	if err := Send(r, message()); err != nil {
		t.Fatal(err)
	}
	_, secure, _ := relay.saw()
	if !contains(secure, "AUTH LOGIN") {
		t.Errorf("LOGIN was never tried: %v", secure)
	}
}

// Not "sending failed": the relay's own reply is what separates three different afternoons.
func TestARefusalCarriesTheRelaysOwnWords(t *testing.T) {
	relay := newRelay(t)
	relay.rejectData = "550 5.7.1 this sender is not allowed"
	defer relay.trust()()

	err := Send(relay.relay(), message())
	if err == nil {
		t.Fatal("a 550 was reported as a success")
	}
	if !strings.Contains(err.Error(), "this sender is not allowed") {
		t.Errorf("the relay's words did not come back: %q", err)
	}
}

// A display name holding a comma, done by hand, produces a header that parses as a different
// address than the one meant.
func TestADisplayNameWithACommaIsQuoted(t *testing.T) {
	relay := newRelay(t)
	defer relay.trust()()

	r := relay.relay()
	r.FromName = "taskio, the task list"

	if err := Send(r, message()); err != nil {
		t.Fatal(err)
	}
	_, _, body := relay.saw()

	from := header(body, "From")
	if !strings.Contains(from, `"taskio, the task list"`) {
		t.Errorf("From = %q, want the name quoted", from)
	}
	// One recipient, not two.
	if strings.Count(header(body, "To"), "@") != 1 {
		t.Errorf("To = %q", header(body, "To"))
	}
}

// Anything outside ASCII has to be encoded, or the header is not a header.
func TestASubjectOutsideASCIIIsEncoded(t *testing.T) {
	relay := newRelay(t)
	defer relay.trust()()

	msg := message()
	msg.Subject = "Ваш код"
	if err := Send(relay.relay(), msg); err != nil {
		t.Fatal(err)
	}
	_, _, body := relay.saw()

	subject := header(body, "Subject")
	if !strings.HasPrefix(subject, "=?utf-8?") {
		t.Errorf("Subject = %q, want it encoded", subject)
	}
}

// Implicit TLS is the other half, and is what the refusal above points people at.
func TestImplicitTLSWorks(t *testing.T) {
	relay := newRelay(t)
	relay.implicit = true
	defer relay.trust()()

	if err := Send(relay.relay(), message()); err != nil {
		t.Fatal(err)
	}
	plaintext, secure, _ := relay.saw()
	if len(plaintext) != 0 {
		t.Errorf("something crossed in the clear: %v", plaintext)
	}
	if !hasPrefix(secure, "DATA") {
		t.Errorf("nothing was sent: %v", secure)
	}
}

// A certificate that does not verify is its own afternoon, and says so.
func TestACertificateThatDoesNotVerifyIsNamed(t *testing.T) {
	relay := newRelay(t)
	// No trust() here: the sender is left with the system roots, which do not know this cert.

	err := Send(relay.relay(), message())
	if err == nil {
		t.Fatal("an unverifiable certificate was accepted")
	}
	if !strings.Contains(err.Error(), "certificate") {
		t.Errorf("the failure does not name the certificate: %q", err)
	}
}

func contains(lines []string, want string) bool {
	for _, line := range lines {
		if strings.EqualFold(strings.TrimSpace(line), want) {
			return true
		}
	}
	return false
}

func hasPrefix(lines []string, verb string) bool {
	for _, line := range lines {
		if strings.HasPrefix(strings.ToUpper(line), verb) {
			return true
		}
	}
	return false
}

// header reads one from the composed message.
func header(body, name string) string {
	for _, line := range strings.Split(body, "\r\n") {
		if line == "" {
			return ""
		}
		if value, ok := strings.CutPrefix(line, name+": "); ok {
			return value
		}
	}
	return ""
}
