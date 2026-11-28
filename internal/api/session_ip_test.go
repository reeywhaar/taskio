package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// A session says where it was last used from, as a token does, and follows a browser that moves.
// Not a change a backup is sent for.
func TestASessionSaysWhereItWasLastUsedFrom(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	me, _ := c.json(c.do("GET", "/api/auth/me", ""))["id"].(string)

	// httptest's requests come from 192.0.2.1.
	list := c.json(c.do("GET", "/api/sessions", ""))["sessions"].([]any)
	if got := list[0].(map[string]any)["last_ip"]; got != "192.0.2.1" {
		t.Fatalf("last_ip = %v, want where it signed in from", got)
	}

	before := st.Changes()
	r := httptest.NewRequest("GET", "/api/auth/me", nil)
	r.RemoteAddr = "198.51.100.7:4321"
	r.AddCookie(c.cookie)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("me from elsewhere = %d", w.Code)
	}
	// From the store: asking over the API is itself a request from 192.0.2.1, which moves it back.
	sessions, err := st.Sessions(context.Background(), me)
	if err != nil {
		t.Fatal(err)
	}
	if got := sessions[0].LastIP; got != "198.51.100.7" {
		t.Errorf("last_ip after moving = %q, want the new address", got)
	}
	if after := st.Changes(); after != before {
		t.Errorf("changes went from %d to %d", before, after)
	}
}
