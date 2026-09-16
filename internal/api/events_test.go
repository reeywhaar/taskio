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

// stream opens the event stream against a real listener, because httptest.NewRecorder buffers
// and what is being tested is that something arrives before the handler returns.
func stream(t *testing.T, s *Server, cookie *http.Cookie) *bufio.Reader {
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
	return bufio.NewReader(resp.Body)
}

// next reads until an event arrives, or says what it saw instead.
func next(t *testing.T, r *bufio.Reader) string {
	t.Helper()
	done := make(chan string, 1)
	go func() {
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				done <- "read failed: " + err.Error()
				return
			}
			if strings.HasPrefix(line, "event: ") {
				done <- strings.TrimSpace(strings.TrimPrefix(line, "event: "))
				return
			}
		}
	}()
	select {
	case got := <-done:
		return got
	case <-time.After(3 * time.Second):
		return "nothing arrived"
	}
}

func TestAWriteReachesAnOpenStream(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	r := stream(t, s, c.cookie)

	c.task(`{"title":"Fix the tap"}`)

	if got := next(t, r); got != "changed" {
		t.Errorf("the stream said %q", got)
	}
}

// The two tabs are the point: one writes and the other is told without asking.
func TestAWriteFromElsewhereReachesTheStream(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	r := stream(t, s, c.cookie)

	other := newClient(t, s)
	other.cookie = c.cookie
	other.task(`{"title":"Written in the other tab"}`)

	if got := next(t, r); got != "changed" {
		t.Errorf("the stream said %q", got)
	}
}

// Reading a list is not a change, and a stream that fires on reads is a refetch loop.
func TestReadsDoNotReachTheStream(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"Fix the tap"}`)
	r := stream(t, s, c.cookie)

	for range 3 {
		c.list("")
	}
	if got := next(t, r); got != "nothing arrived" {
		t.Errorf("a read produced %q", got)
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
