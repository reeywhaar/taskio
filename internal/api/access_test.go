package api

import (
	"context"
	"io"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"
)

// A person makes a link for a group; whoever opens it reads markdown with a token for the
// project, told to keep to the group. Five minutes for the page, thirty for the token.
func TestAnAccessLinkHandsAnAgentATokenForAWhile(t *testing.T) {
	s, st := newServerStore(t, nil)
	buf := logged(s)
	start := time.Date(2026, 11, 22, 12, 0, 0, 0, time.UTC)
	now := start
	st.SetClock(func() time.Time { return now })

	c := signIn(t, s, st)
	me, _ := c.json(c.do("GET", "/api/auth/me", ""))["id"].(string)
	project, err := st.DefaultProject(context.Background(), me)
	if err != nil {
		t.Fatal(err)
	}
	g, err := st.CreateGroup(context.Background(), project.PrincipalID, project.ID, "Garden", []string{"garden", "outside"}, "")
	if err != nil {
		t.Fatal(err)
	}

	resp := c.do("POST", "/api/access", `{"group":"`+g.ID+`"}`)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create = %s", resp.Status)
	}
	made := c.json(resp)
	url, _ := made["url"].(string)
	const base = "https://taskio.example.com"
	if !strings.HasPrefix(url, base+"/access/") {
		t.Fatalf("url = %q", url)
	}
	if made["expires_at"] != float64(start.Add(5*time.Minute).Unix()) ||
		made["token_expires_at"] != float64(start.Add(30*time.Minute).Unix()) {
		t.Errorf("made = %v", made)
	}
	path := strings.TrimPrefix(url, base)

	// Opened by anybody, signed in or not: the link is the credential.
	page := newClient(t, s).do("GET", path, "")
	if page.StatusCode != http.StatusOK || !strings.HasPrefix(page.Header.Get("Content-Type"), "text/plain") {
		t.Fatalf("page = %s %s", page.Status, page.Header.Get("Content-Type"))
	}
	if page.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("cache-control = %q", page.Header.Get("Cache-Control"))
	}
	body, _ := io.ReadAll(page.Body)
	text := string(body)
	for _, want := range []string{"five minutes", base + "/docs.md", "**Garden**", "tags=and(garden,outside)", "`" + project.Slug + "`", "Bearer $(nonced)"} {
		if !strings.Contains(text, want) {
			t.Errorf("the page does not say %q:\n%s", want, text)
		}
	}
	token := regexp.MustCompile(`tk_[A-Za-z0-9_-]+`).FindString(text)
	if token == "" {
		t.Fatalf("no token on the page:\n%s", text)
	}
	// Below the opening lines, which a chat's preview of the link shows.
	if first := strings.Join(strings.SplitN(text, "\n", 6)[:5], "\n"); strings.Contains(first, token) {
		t.Error("the token is in the page's opening lines")
	}

	bearer := map[string]string{"Authorization": "Bearer " + token}
	if r := do(t, s, "GET", "/api/tasks", "", bearer); r.StatusCode != http.StatusOK {
		t.Fatalf("the token = %s", r.Status)
	}

	now = start.Add(6 * time.Minute)
	if r := newClient(t, s).do("GET", path, ""); r.StatusCode != http.StatusNotFound {
		t.Errorf("page after five minutes = %s, want 404", r.Status)
	}
	if got := warnings(buf); len(got) != 1 || !strings.Contains(got[0], `msg="link refused"`) {
		t.Errorf("warnings = %q", got)
	}
	if r := do(t, s, "GET", "/api/tasks", "", bearer); r.StatusCode != http.StatusOK {
		t.Errorf("the token after the page = %s", r.Status)
	}
	now = start.Add(30 * time.Minute)
	if r := do(t, s, "GET", "/api/tasks", "", bearer); r.StatusCode != http.StatusUnauthorized {
		t.Errorf("the token after thirty minutes = %s, want 401", r.Status)
	}
}

// A person lets an agent in; an agent does not hand itself another way in.
func TestAnAgentCannotMakeAnAccessLink(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	made := c.json(c.do("POST", "/api/access", `{}`))
	path := strings.TrimPrefix(made["url"].(string), "https://taskio.example.com")
	body, _ := io.ReadAll(newClient(t, s).do("GET", path, "").Body)
	token := regexp.MustCompile(`tk_[A-Za-z0-9_-]+`).FindString(string(body))

	r := do(t, s, "POST", "/api/access", `{}`, map[string]string{
		"Authorization": "Bearer " + token, "Content-Type": "application/json",
	})
	if r.StatusCode != http.StatusUnauthorized {
		t.Errorf("an agent making a link = %s, want 401", r.Status)
	}
	// And the whole-project page asks for no group.
	if strings.Contains(string(body), "Scope:") {
		t.Errorf("a whole-project page names a scope:\n%s", body)
	}
}

// The dialog can narrow the token after the link is made; the page says what it reaches then.
func TestTheAccessPageSaysWhatTheTokenReachesNow(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	made := c.json(c.do("POST", "/api/access", `{}`))
	id, _ := made["token"].(string)
	if id == "" {
		t.Fatalf("made = %v, want the token's id", made)
	}
	me, _ := c.json(c.do("GET", "/api/auth/me", ""))["id"].(string)
	project, err := st.DefaultProject(context.Background(), me)
	if err != nil {
		t.Fatal(err)
	}
	body := `{"projects":[{"project":"` + project.Slug + `","scope":"and(garden)"}]}`
	if r := c.do("PATCH", "/api/tokens/"+id, body); r.StatusCode != http.StatusOK {
		t.Fatalf("narrowing = %s", r.Status)
	}
	path := strings.TrimPrefix(made["url"].(string), "https://taskio.example.com")
	page, _ := io.ReadAll(newClient(t, s).do("GET", path, "").Body)
	if !strings.Contains(string(page), "only the tasks matching `garden`") {
		t.Errorf("the page does not say the narrowed reach:\n%s", page)
	}
}

// The token an agent holds cannot change itself, or make itself another: every route that
// manages tokens is a signed-in browser's, and answers a token 401.
func TestAnAgentCannotTouchTokens(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	made := c.json(c.do("POST", "/api/access", `{}`))
	id, _ := made["token"].(string)
	path := strings.TrimPrefix(made["url"].(string), "https://taskio.example.com")
	page, _ := io.ReadAll(newClient(t, s).do("GET", path, "").Body)
	token := regexp.MustCompile(`tk_[A-Za-z0-9_-]+`).FindString(string(page))
	bearer := map[string]string{"Authorization": "Bearer " + token, "Content-Type": "application/json"}

	for _, call := range []struct{ method, path, body string }{
		{"GET", "/api/tokens", ""},
		{"POST", "/api/tokens", `{"label":"more"}`},
		{"PATCH", "/api/tokens/" + id, `{"projects":[]}`},
		{"POST", "/api/tokens/" + id + "/rotate", ""},
		{"POST", "/api/tokens/" + id + "/extend", ""},
		{"DELETE", "/api/tokens/revoked", ""},
		{"DELETE", "/api/tokens/" + id, ""},
		{"POST", "/api/access", `{}`},
	} {
		if r := do(t, s, call.method, call.path, call.body, bearer); r.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s %s with the agent's token = %s, want 401", call.method, call.path, r.Status)
		}
	}
	// And it still works for what it is for.
	if r := do(t, s, "GET", "/api/tasks", "", bearer); r.StatusCode != http.StatusOK {
		t.Errorf("the token on tasks = %s", r.Status)
	}
}

// Extend is the browser's, gives another half hour, and the row says the token is an agent's.
func TestExtendingAnAgentsAccess(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	made := c.json(c.do("POST", "/api/access", `{}`))
	id, _ := made["token"].(string)
	was := made["token_expires_at"].(float64)

	resp := c.do("POST", "/api/tokens/"+id+"/extend", "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("extend = %s", resp.Status)
	}
	got := c.json(resp)
	if got["expires_at"] != was+30*60 || got["temporary"] != true {
		t.Errorf("extended = %v, want half an hour more on a temporary token", got)
	}
}
