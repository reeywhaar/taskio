package api

import (
	"bytes"
	"log/slog"
	"net/http"
	"strings"
	"testing"
)

// warnings is what the server logged at WARN, a line each.
func warnings(buf *bytes.Buffer) []string {
	var out []string
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if strings.Contains(line, "level=WARN") {
			out = append(out, line)
		}
	}
	return out
}

func logged(s *Server) *bytes.Buffer {
	var buf bytes.Buffer
	s.log = slog.New(slog.NewTextHandler(&buf, nil))
	return &buf
}

// What fail2ban reads: every refusal at the door is one WARN line, a fixed message and then the
// address. httptest's requests come from 192.0.2.1, which is no proxy of ours.
func TestRefusalsAreLoggedWithTheAddress(t *testing.T) {
	s, st := newServerStore(t, nil)
	buf := logged(s)
	account(t, st, "misha", "a good password")
	c := newClient(t, s)

	c.do("POST", "/api/auth/login", `{"username":"misha","password":"not it"}`)
	c.do("POST", "/api/auth/login", `{"username":"nobody","password":"not it"}`)
	do(t, s, "GET", "/api/tasks", "", map[string]string{"Authorization": "Bearer tk_not-one-of-ours"})
	c.do("GET", "/api/auth/invites/not-one-of-ours", "")
	c.do("POST", "/api/auth/recoveries/not-one-of-ours/accept", `{"password":"a good password"}`)

	want := []string{
		`msg="sign-in refused" ip=192.0.2.1`,
		`msg="sign-in refused" ip=192.0.2.1`,
		`msg="token refused" ip=192.0.2.1`,
		`msg="link refused" ip=192.0.2.1`,
		`msg="link refused" ip=192.0.2.1`,
	}
	got := warnings(buf)
	if len(got) != len(want) {
		t.Fatalf("warnings = %q, want %d", got, len(want))
	}
	for i, line := range got {
		if !strings.Contains(line, want[i]) {
			t.Errorf("warning %d = %q, want it to say %s", i, line, want[i])
		}
		// A missing account and a wrong password read the same here too, and a username that
		// was tried is sometimes a password.
		if strings.Contains(line, "misha") || strings.Contains(line, "nobody") {
			t.Errorf("warning %d names the account tried: %q", i, line)
		}
	}
}

func TestASignInPastTheLimitIsLoggedAsLimited(t *testing.T) {
	s, st := newServerStore(t, nil)
	buf := logged(s)
	account(t, st, "misha", "a good password")
	c := newClient(t, s)

	var last *http.Response
	for range 6 {
		last = c.do("POST", "/api/auth/login", `{"username":"misha","password":"not it"}`)
	}
	if last.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("sixth sign-in = %s, want 429", last.Status)
	}
	got := warnings(buf)
	if n := len(got); n != 6 || !strings.Contains(got[n-1], `msg="sign-in rate limited" ip=192.0.2.1`) {
		t.Errorf("warnings = %q", got)
	}
}

// A recovery link that was ours, and is used, is a person who pressed it twice: not something to
// ban. (A used invitation is not found at all, and one refusal is far from a ban.)
func TestAUsedLinkIsNotCountedAsAGuess(t *testing.T) {
	s, st := newServerStore(t, nil)
	buf := logged(s)
	p := account(t, st, "misha", "a good password")
	c := newClient(t, s)
	token := link(t, st, p.ID)
	for range 2 {
		c.do("POST", "/api/auth/recoveries/"+token+"/accept", `{"password":"another good password"}`)
	}
	c.do("GET", "/api/auth/recoveries/"+token, "")
	if got := warnings(buf); len(got) != 0 {
		t.Errorf("warnings = %q, want none", got)
	}
}
