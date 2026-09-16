package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"taskio/internal/session"
	"taskio/internal/store"
)

// client keeps a cookie jar of one, which is all a session is.
type client struct {
	t      *testing.T
	server *Server
	cookie *http.Cookie
}

func newClient(t *testing.T, s *Server) *client { return &client{t: t, server: s} }

func (c *client) do(method, path, body string) *http.Response {
	c.t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
		r.ContentLength = 0
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	}
	r.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Firefox/140.0")
	if c.cookie != nil {
		r.AddCookie(c.cookie)
	}
	w := httptest.NewRecorder()
	c.server.ServeHTTP(w, r)
	resp := w.Result()
	for _, ck := range resp.Cookies() {
		if ck.Name == session.CookieName {
			if ck.MaxAge < 0 {
				c.cookie = nil
			} else {
				c.cookie = ck
			}
		}
	}
	return resp
}

func (c *client) json(resp *http.Response) map[string]any {
	c.t.Helper()
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	return out
}

func account(t *testing.T, st *store.Store, username, password string) *store.Principal {
	t.Helper()
	p, err := st.CreatePrincipal(context.Background(), username, password, store.RoleUser)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func signIn(t *testing.T, s *Server, st *store.Store) *client {
	t.Helper()
	account(t, st, "misha", "a good password")
	c := newClient(t, s)
	if resp := c.do("POST", "/api/auth/login", `{"username":"misha","password":"a good password"}`); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("login = %s", resp.Status)
	}
	if c.cookie == nil {
		t.Fatal("signing in set no cookie")
	}
	return c
}

func TestSignInAndOut(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	me := c.json(c.do("GET", "/api/auth/me", ""))
	if me["username"] != "misha" {
		t.Fatalf("me = %v", me)
	}

	if resp := c.do("POST", "/api/auth/logout", ""); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("logout = %s", resp.Status)
	}
	if c.cookie != nil {
		t.Error("signing out left the cookie in place")
	}
	if resp := c.do("GET", "/api/auth/me", ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("me after logout = %s, want 401", resp.Status)
	}
}

// One refusal for a wrong password and a missing account: response latency and wording are
// otherwise a list of which usernames exist.
func TestAWrongPasswordAndAMissingAccountRefuseIdentically(t *testing.T) {
	s, st := newServerStore(t, nil)
	account(t, st, "misha", "a good password")
	c := newClient(t, s)

	wrong := c.do("POST", "/api/auth/login", `{"username":"misha","password":"not it"}`)
	missing := c.do("POST", "/api/auth/login", `{"username":"nobody","password":"not it"}`)

	if wrong.StatusCode != http.StatusUnauthorized || missing.StatusCode != http.StatusUnauthorized {
		t.Fatalf("statuses = %s and %s", wrong.Status, missing.Status)
	}
	a, b := c.json(wrong), c.json(missing)
	if a["message"] != b["message"] || a["code"] != b["code"] {
		t.Errorf("refusals differ: %v vs %v", a, b)
	}
}

// Never a redirect: a 302 to an HTML page is the least useful thing a fetch can receive.
func TestAnUnauthenticatedAPICallIsJSONAndNotARedirect(t *testing.T) {
	s := newServer(t, nil)
	resp := newClient(t, s).do("GET", "/api/auth/me", "")

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %s", resp.Status)
	}
	if loc := resp.Header.Get("Location"); loc != "" {
		t.Errorf("redirected to %q", loc)
	}
	var body errorBody
	json.NewDecoder(resp.Body).Decode(&body)
	if body.Ok || body.Code != CodeUnauthenticated {
		t.Errorf("body = %+v", body)
	}
}

func TestTheSessionCookieIsHttpOnlyAndSecure(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	if !c.cookie.HttpOnly {
		t.Error("the cookie is readable from script")
	}
	if !c.cookie.Secure {
		t.Error("an https instance shipped the cookie without Secure")
	}
	if c.cookie.SameSite != http.SameSiteLaxMode {
		t.Errorf("SameSite = %v, want Lax", c.cookie.SameSite)
	}
}

// Per-username, so somebody working through a password list against one account does not get
// to share the global budget with everybody else.
func TestLoginIsRateLimitedPerUsername(t *testing.T) {
	s, st := newServerStore(t, nil)
	account(t, st, "misha", "a good password")
	c := newClient(t, s)

	var limited bool
	for i := 0; i < 12; i++ {
		resp := c.do("POST", "/api/auth/login", `{"username":"misha","password":"wrong"}`)
		if resp.StatusCode == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	if !limited {
		t.Fatal("a password list against one account was never slowed down")
	}

	// Another account is unaffected, which is the point of the second bucket.
	account(t, st, "other", "a good password")
	if resp := c.do("POST", "/api/auth/login", `{"username":"other","password":"a good password"}`); resp.StatusCode != http.StatusNoContent {
		t.Errorf("a second account was locked out by the first: %s", resp.Status)
	}
}

func TestAnInvitationMakesOneAccount(t *testing.T) {
	s, st := newServerStore(t, nil)
	inv, token, err := st.CreateInvite(context.Background(), "", store.RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}

	c := newClient(t, s)
	got := c.json(c.do("GET", "/api/auth/invites/"+token, ""))
	if got["role"] != store.RoleAdmin {
		t.Errorf("invite = %v", got)
	}
	_ = inv

	body := `{"username":"misha","password":"a good password"}`
	if resp := c.do("POST", "/api/auth/invites/"+token+"/accept", body); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("accept = %s", resp.Status)
	}
	// Accepting signs you in: being shown a login form straight afterwards is asking somebody
	// to prove something they just proved.
	if c.cookie == nil {
		t.Fatal("accepting an invitation did not sign the account in")
	}
	if me := c.json(c.do("GET", "/api/auth/me", "")); me["role"] != store.RoleAdmin {
		t.Errorf("me = %v", me)
	}

	// Single use.
	second := newClient(t, s)
	if resp := second.do("POST", "/api/auth/invites/"+token+"/accept", `{"username":"other","password":"a good password"}`); resp.StatusCode == http.StatusNoContent {
		t.Error("one invitation made two accounts")
	}
}

func TestTheSessionListShowsThisBrowserAndTheOthers(t *testing.T) {
	s, st := newServerStore(t, nil)
	here := signIn(t, s, st)

	elsewhere := newClient(t, s)
	elsewhere.do("POST", "/api/auth/login", `{"username":"misha","password":"a good password"}`)

	body := here.json(here.do("GET", "/api/sessions", ""))
	list, _ := body["sessions"].([]any)
	if len(list) != 2 {
		t.Fatalf("sessions = %v", body)
	}
	var current int
	for _, row := range list {
		m := row.(map[string]any)
		if m["current"] == true {
			current++
		}
		if m["device"] != "Firefox on a Mac" {
			t.Errorf("device = %v, want the guess beside the string", m["device"])
		}
		if m["user_agent"] == "" {
			t.Error("the raw user agent is not shown beside the guess")
		}
	}
	if current != 1 {
		t.Errorf("%d rows claimed to be the current session", current)
	}
}

// Signing out everywhere else keeps the tab the button was pressed in.
func TestRevokingOtherSessionsKeepsThisOne(t *testing.T) {
	s, st := newServerStore(t, nil)
	here := signIn(t, s, st)
	elsewhere := newClient(t, s)
	elsewhere.do("POST", "/api/auth/login", `{"username":"misha","password":"a good password"}`)

	if resp := here.do("DELETE", "/api/sessions", ""); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke others = %s", resp.Status)
	}
	if resp := here.do("GET", "/api/auth/me", ""); resp.StatusCode != http.StatusOK {
		t.Errorf("this session was signed out by its own button: %s", resp.Status)
	}
	if resp := elsewhere.do("GET", "/api/auth/me", ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("the other session survived: %s", resp.Status)
	}
}

// Revoking the browser you are reading from is a coherent thing to want, and it lands you
// signed out rather than refused.
func TestTheCurrentSessionCanBeRevoked(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	body := c.json(c.do("GET", "/api/sessions", ""))
	id := body["sessions"].([]any)[0].(map[string]any)["id"].(string)

	if resp := c.do("DELETE", "/api/sessions/"+id, ""); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke = %s", resp.Status)
	}
	if c.cookie != nil {
		t.Error("the cookie survived revoking its own session")
	}
}

// An id belonging to somebody else's session matches nothing rather than deleting it.
func TestOneAccountCannotRevokeAnothersSession(t *testing.T) {
	s, st := newServerStore(t, nil)
	mine := signIn(t, s, st)

	account(t, st, "other", "a good password")
	theirs := newClient(t, s)
	theirs.do("POST", "/api/auth/login", `{"username":"other","password":"a good password"}`)
	theirID := theirs.json(theirs.do("GET", "/api/sessions", ""))["sessions"].([]any)[0].(map[string]any)["id"].(string)

	if resp := mine.do("DELETE", "/api/sessions/"+theirID, ""); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %s, want 404", resp.Status)
	}
	if resp := theirs.do("GET", "/api/auth/me", ""); resp.StatusCode != http.StatusOK {
		t.Error("somebody else's session was revoked")
	}
}

// Changing a password ends every other session and keeps this one, and the sessions go first.
func TestChangingAPasswordEndsOtherSessions(t *testing.T) {
	s, st := newServerStore(t, nil)
	ctx := context.Background()
	here := signIn(t, s, st)
	elsewhere := newClient(t, s)
	elsewhere.do("POST", "/api/auth/login", `{"username":"misha","password":"a good password"}`)

	p, _ := st.Authenticate(ctx, "misha", "a good password")
	if err := st.SetPassword(ctx, p.ID, "a better password", hashOf(session.Token(requestWith(here.cookie)))); err != nil {
		t.Fatal(err)
	}

	if resp := here.do("GET", "/api/auth/me", ""); resp.StatusCode != http.StatusOK {
		t.Errorf("the session that changed the password was ended: %s", resp.Status)
	}
	if resp := elsewhere.do("GET", "/api/auth/me", ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("another session survived a password change: %s", resp.Status)
	}
	if _, err := st.Authenticate(ctx, "misha", "a good password"); err == nil {
		t.Error("the old password still works")
	}
}

func jsonOf(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	return out
}

func readAll(t *testing.T, resp *http.Response) string {
	t.Helper()
	b, _ := io.ReadAll(resp.Body)
	return string(b)
}

func requestWith(c *http.Cookie) *http.Request {
	r := httptest.NewRequest("GET", "/", nil)
	if c != nil {
		r.AddCookie(c)
	}
	return r
}

func hashOf(token string) []byte { return store.HashToken(token) }

var _ = fstest.MapFS{}
