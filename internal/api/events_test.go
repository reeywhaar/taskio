package api

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// stream opens the event stream and returns the events off it by name.
//
// One reader for the life of the stream, feeding a channel. Reading on demand instead would
// mean a goroutine left blocked on every call that timed out, and the next event going to that
// one rather than to the test waiting for it.
func stream(t *testing.T, s *Server, cookie *http.Cookie) <-chan string {
	t.Helper()
	srv := httptest.NewServer(s)
	t.Cleanup(srv.Close)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/api/events", nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stream = %s", resp.Status)
	}
	if got := resp.Header.Get("Content-Type"); !strings.HasPrefix(got, "text/event-stream") {
		t.Fatalf("content type = %q", got)
	}

	events := make(chan string, 8)
	go func() {
		defer close(events)
		r := bufio.NewReader(resp.Body)
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				return
			}
			if name, ok := strings.CutPrefix(line, "event: "); ok {
				events <- strings.TrimSpace(name)
			}
		}
	}()
	return events
}

// next is the next event, or what happened instead.
func next(t *testing.T, events <-chan string) string {
	t.Helper()
	select {
	case got, ok := <-events:
		if !ok {
			return "the stream closed"
		}
		return got
	case <-time.After(2 * time.Second):
		return "nothing arrived"
	}
}

func TestAWriteReachesAnOpenStream(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	events := stream(t, s, c.cookie)

	c.task(`{"title":"Fix the tap"}`)

	if got := next(t, events); got != "changed" {
		t.Errorf("the stream said %q", got)
	}
}

// The two tabs are the point: one writes and the other is told without asking.
func TestAWriteFromElsewhereReachesTheStream(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	events := stream(t, s, c.cookie)

	other := newClient(t, s)
	other.cookie = c.cookie
	other.task(`{"title":"Written in the other tab"}`)

	if got := next(t, events); got != "changed" {
		t.Errorf("the stream said %q", got)
	}
}

// Reading a list is not a change, and a stream that fires on reads is a refetch loop.
func TestReadsDoNotReachTheStream(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"Fix the tap"}`)
	events := stream(t, s, c.cookie)

	for range 3 {
		c.list("")
	}
	if got := next(t, events); got != "nothing arrived" {
		t.Errorf("a read produced %q", got)
	}
}

// Nobody is told that somebody else is working. A stream every account hears is a fact about
// other people's afternoons, delivered to anyone with a tab open.
func TestOneAccountsWritesDoNotReachAnother(t *testing.T) {
	s, st := newServerStore(t, nil)
	mine := signIn(t, s, st)

	// Both accounts exist before the stream opens: making one is an instance-wide change and
	// would be the event under test rather than their writing.
	account(t, st, "someone-else", "a good password")
	theirs := newClient(t, s)
	if resp := theirs.do("POST", "/api/auth/login",
		`{"username":"someone-else","password":"a good password"}`); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("their login = %s", resp.Status)
	}

	events := stream(t, s, mine.cookie)
	theirs.task(`{"title":"None of my business"}`)

	if got := next(t, events); got != "nothing arrived" {
		t.Errorf("their write reached my stream as %q", got)
	}

	// And mine still does, so the silence above is scoping rather than a stream that is dead.
	mine.task(`{"title":"Mine"}`)
	if got := next(t, events); got != "changed" {
		t.Errorf("my own write said %q", got)
	}
}

// The relay, the limits, the roll of accounts: nobody's in particular, so everybody hears it.
func TestAnInstanceWideChangeReachesEverybody(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	events := stream(t, s, c.cookie)

	if _, err := st.CreatePrincipal(context.Background(), "newcomer", "a good password", "user"); err != nil {
		t.Fatal(err)
	}
	if got := next(t, events); got != "changed" {
		t.Errorf("an account being made said %q", got)
	}
}

func TestTheStreamNeedsASession(t *testing.T) {
	s := newServer(t, nil)
	srv := httptest.NewServer(s)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/events")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("signed out = %s, want 401", resp.Status)
	}
}

// Held open, it would keep a deploy waiting for somebody to close a tab.
func TestTheStreamEndsWhenItsRequestIsCancelled(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	srv := httptest.NewServer(s)
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/api/events", nil)
	req.AddCookie(c.cookie)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	cancel()
	done := make(chan error, 1)
	go func() {
		_, err := resp.Body.Read(make([]byte, 1))
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Error("the stream carried on after its request was cancelled")
		}
	case <-time.After(3 * time.Second):
		t.Error("the stream did not end when its request was cancelled")
	}
}
