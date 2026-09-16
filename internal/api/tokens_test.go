package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"taskio/internal/store"
)

// agent is a caller with a token rather than a cookie.
type agent struct {
	t      *testing.T
	server *Server
	secret string
}

func (a *agent) do(method, path, body string) *http.Response {
	a.t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
		r.ContentLength = 0
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	}
	r.Header.Set("Authorization", "Bearer "+a.secret)
	w := httptest.NewRecorder()
	a.server.ServeHTTP(w, r)
	return w.Result()
}

func (a *agent) json(resp *http.Response) map[string]any {
	a.t.Helper()
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	return out
}

func mintToken(t *testing.T, s *Server, c *client, label, scope string) *agent {
	t.Helper()
	body := `{"label":"` + label + `","scope":"` + scope + `"}`
	resp := c.do("POST", "/api/tokens", body)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("mint = %s", resp.Status)
	}
	secret, _ := c.json(resp)["secret"].(string)
	if !strings.HasPrefix(secret, store.TokenPrefix) {
		t.Fatalf("secret = %q", secret)
	}
	return &agent{t: t, server: s, secret: secret}
}

func TestATokenReachesTheTaskAPI(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	a := mintToken(t, s, c, "claude", "")

	if resp := a.do("POST", "/api/tasks", `{"title":"Fix the tap"}`); resp.StatusCode != http.StatusCreated {
		t.Fatalf("create with a token = %s", resp.Status)
	}
	if got := len(c.list("")["tasks"].([]any)); got != 1 {
		t.Error("the task the token wrote is not on the account")
	}
}

// A credential must not mint or manage credentials.
func TestATokenCannotReachTheSessionOrTokenRoutes(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	a := mintToken(t, s, c, "claude", "")

	for _, path := range []string{"/api/tokens", "/api/sessions", "/api/auth/me"} {
		if resp := a.do("GET", path, ""); resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s with a token = %s, want 401", path, resp.Status)
		}
	}
}

// A scoped token sees only tasks carrying its tags, and everything it creates is given them.
func TestAScopeNarrowsAndApplies(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"Work thing","tags":["work"]}`)
	c.task(`{"title":"Private thing","tags":["private"]}`)

	a := mintToken(t, s, c, "claude", "and(work)")

	body := jsonOf(t, a.do("GET", "/api/tasks", ""))
	list := body["tasks"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["title"] != "Work thing" {
		t.Fatalf("a scoped token sees %v", body)
	}

	// Created with no tags at all, and it comes back tagged.
	made := jsonOf(t, a.do("POST", "/api/tasks", `{"title":"Call the plumber"}`))
	tags := made["tags"].([]any)
	if len(tags) != 1 || tags[0] != "work" {
		t.Errorf("tags = %v, want the scope applied", tags)
	}
}

// Authenticated, and the task is theirs; what is refused is this credential's reach. A 404
// would have an agent conclude the task is gone and act on it.
func TestReachingPastAScopeIs403(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.task(`{"title":"Private thing","tags":["private"]}`)["id"].(string)
	a := mintToken(t, s, c, "claude", "and(work)")

	resp := a.do("GET", "/api/tasks/"+id, "")
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %s, want 403", resp.Status)
	}
}

// A write may not take a task out of the writer's reach.
func TestAScopedTokenCannotDropItsOwnScopeTag(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.task(`{"title":"Work thing","tags":["work","urgent"]}`)["id"].(string)
	a := mintToken(t, s, c, "claude", "and(work)")

	// Asking for no tags at all still leaves the scope's on.
	got := jsonOf(t, a.do("PATCH", "/api/tasks/"+id, `{"tags":[]}`))
	tags := got["tags"].([]any)
	if len(tags) != 1 || tags[0] != "work" {
		t.Errorf("tags = %v, want the scope kept", tags)
	}

	// And it cannot rename or remove the tag it is scoped to.
	if resp := a.do("DELETE", "/api/tags/work", ""); resp.StatusCode != http.StatusForbidden {
		t.Errorf("removing its own scope tag = %s, want 403", resp.Status)
	}
	if resp := a.do("PATCH", "/api/tags/work", `{"slug":"job"}`); resp.StatusCode != http.StatusForbidden {
		t.Errorf("renaming its own scope tag = %s, want 403", resp.Status)
	}
}

// Whether a word exists elsewhere on the account is not something a confined credential learns.
func TestAScopedTokenSeesOnlyItsOwnTags(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"Work thing","tags":["work","urgent"]}`)
	c.task(`{"title":"Private thing","tags":["therapy"]}`)

	a := mintToken(t, s, c, "claude", "and(work)")
	body := jsonOf(t, a.do("GET", "/api/tags", ""))

	var slugs []string
	for _, row := range body["tags"].([]any) {
		slugs = append(slugs, row.(map[string]any)["slug"].(string))
	}
	for _, slug := range slugs {
		if slug == "therapy" {
			t.Fatalf("a scoped token was shown %v", slugs)
		}
	}
	if len(slugs) != 2 {
		t.Errorf("tags = %v, want work and urgent", slugs)
	}
}

// A scope is a flat and() of tags, because only that answers "create it with these tags".
func TestAScopeMustBeAFlatAnd(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	for _, scope := range []string{"not(private)", "or(work,home)", "and(work,not(private))"} {
		resp := c.do("POST", "/api/tokens", `{"label":"x","scope":"`+scope+`"}`)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("scope %q = %s, want 400", scope, resp.Status)
		}
	}
}

// Proved rather than sent, because this credential ends up in transcripts.
func TestANoncedTokenAuthenticates(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	a := mintToken(t, s, c, "claude", "")

	nonced := store.NoncedValue(a.secret, time.Now())
	if strings.Contains(nonced, strings.TrimPrefix(a.secret, store.TokenPrefix)) {
		t.Fatal("the nonced value contains the secret")
	}

	proved := &agent{t: t, server: s, secret: nonced}
	if resp := proved.do("GET", "/api/tasks", ""); resp.StatusCode != http.StatusOK {
		t.Fatalf("a nonced token = %s", resp.Status)
	}

	// And in the URL, which the raw form is not: a value useless in five minutes is safe
	// somewhere a permanent one is not.
	r := httptest.NewRequest("GET", "/api/tasks?token="+nonced, nil)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Result().StatusCode != http.StatusOK {
		t.Errorf("a nonced token in the URL = %s", w.Result().Status)
	}

	// The raw one is header-only.
	r = httptest.NewRequest("GET", "/api/tasks?token="+a.secret, nil)
	w = httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Result().StatusCode == http.StatusOK {
		t.Error("a raw token was accepted in the URL, where it would land in every access log")
	}
}

func TestANoncedTokenExpires(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	a := mintToken(t, s, c, "claude", "")

	stale := store.NoncedValue(a.secret, time.Now().Add(-store.NonceWindow-time.Minute))
	proved := &agent{t: t, server: s, secret: stale}
	if resp := proved.do("GET", "/api/tasks", ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("a nonce outside the window = %s, want 401", resp.Status)
	}
}

// One refusal for every way of being wrong: the difference tells whoever is guessing which
// half they got right.
func TestEveryBadTokenRefusesIdentically(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	a := mintToken(t, s, c, "claude", "")

	revoked := mintToken(t, s, c, "old", "")
	list := c.json(c.do("GET", "/api/tokens", ""))["tokens"].([]any)
	for _, row := range list {
		m := row.(map[string]any)
		if m["label"] == "old" {
			c.do("DELETE", "/api/tokens/"+m["id"].(string), "")
		}
	}

	var messages []string
	for _, secret := range []string{
		"tk_nothing",
		revoked.secret,
		store.NoncedPrefix + "1.2.3",
		a.secret + "x",
	} {
		probe := &agent{t: t, server: s, secret: secret}
		resp := probe.do("GET", "/api/tasks", "")
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%q = %s, want 401", secret[:8], resp.Status)
		}
		messages = append(messages, jsonOf(t, resp)["message"].(string))
	}
	for _, m := range messages[1:] {
		if m != messages[0] {
			t.Errorf("refusals differ: %q vs %q", messages[0], m)
		}
	}
}

func TestAnExpiredTokenStopsWorking(t *testing.T) {
	s, st := newServerStore(t, nil)
	signIn(t, s, st)
	ctx := context.Background()

	p, _ := st.Authenticate(ctx, "misha", "a good password")
	past := time.Now().Add(-time.Hour)
	_, secret, err := st.CreateToken(ctx, p.ID, "expired", "", &past)
	if err != nil {
		t.Fatal(err)
	}
	probe := &agent{t: t, server: s, secret: secret}
	if resp := probe.do("GET", "/api/tasks", ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("an expired token = %s, want 401", resp.Status)
	}
}

// The secret exists once, in the response that mints it.
func TestATokenSecretIsNeverListed(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	a := mintToken(t, s, c, "claude", "")

	resp := c.do("GET", "/api/tokens", "")
	body := readAll(t, resp)
	if strings.Contains(body, a.secret) {
		t.Fatal("the listing carries the secret")
	}
	if !strings.Contains(body, `"hint"`) {
		t.Error("the listing has no hint to match a token against a config file")
	}
}

// The point of editing rather than reissuing: the value in somebody's config keeps working.
func TestATokensScopeCanBeNarrowedWithoutReissuingIt(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	a := mintToken(t, s, c, "claude", "")

	c.task(`{"title":"Fix the tap","tags":["home"]}`)
	c.task(`{"title":"Call the accountant","tags":["work"]}`)
	if got := len(a.json(a.do("GET", "/api/tasks", ""))["tasks"].([]any)); got != 2 {
		t.Fatalf("unscoped token sees %d tasks, want both", got)
	}

	id := c.json(c.do("GET", "/api/tokens", ""))["tokens"].([]any)[0].(map[string]any)["id"].(string)
	resp := c.do("PATCH", "/api/tokens/"+id, `{"scope":"and(work)"}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch = %s", resp.Status)
	}
	// One tag prints as itself: and(work) and work are the same scope, stored one way.
	if got := c.json(resp)["scope"]; got != "work" {
		t.Errorf("scope = %v", got)
	}

	// Same secret, narrower reach, and no reissue in between.
	page := a.json(a.do("GET", "/api/tasks", ""))
	if got := len(page["tasks"].([]any)); got != 1 {
		t.Fatalf("after narrowing the token sees %d tasks, want one", got)
	}
	if got := page["tasks"].([]any)[0].(map[string]any)["title"]; got != "Call the accountant" {
		t.Errorf("it kept the wrong one: %v", got)
	}
}

// Widening is the same call: a scope is a boundary the account owner moves either way.
func TestATokensScopeCanBeWidenedAndRemoved(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	a := mintToken(t, s, c, "claude", "and(work)")

	c.task(`{"title":"Fix the tap","tags":["home"]}`)
	c.task(`{"title":"Call the accountant","tags":["work"]}`)

	id := c.json(c.do("GET", "/api/tokens", ""))["tokens"].([]any)[0].(map[string]any)["id"].(string)
	if resp := c.do("PATCH", "/api/tokens/"+id, `{"scope":""}`); resp.StatusCode != http.StatusOK {
		t.Fatalf("patch = %s", resp.Status)
	}
	if got := len(a.json(a.do("GET", "/api/tasks", ""))["tasks"].([]any)); got != 2 {
		t.Errorf("after removing the scope the token sees %d tasks, want both", got)
	}
}

// One spelling in the listing, whatever was typed — the same canonical form minting stores.
func TestAnEditedScopeIsStoredCanonically(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	mintToken(t, s, c, "claude", "")
	c.task(`{"title":"Fix the tap","tags":["home","work"]}`)

	id := c.json(c.do("GET", "/api/tokens", ""))["tokens"].([]any)[0].(map[string]any)["id"].(string)
	resp := c.do("PATCH", "/api/tokens/"+id, `{"scope":"and( work , home )"}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch = %s", resp.Status)
	}
	if got := c.json(resp)["scope"]; got != "and(work,home)" {
		t.Errorf("scope = %v, want the canonical spelling", got)
	}
}

func TestAScopeThatIsNotAFlatAndIsRefused(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	mintToken(t, s, c, "claude", "")
	c.task(`{"title":"Fix the tap","tags":["home","work"]}`)

	id := c.json(c.do("GET", "/api/tokens", ""))["tokens"].([]any)[0].(map[string]any)["id"].(string)
	resp := c.do("PATCH", "/api/tokens/"+id, `{"scope":"or(home,work)"}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("or() scope = %s, want a refusal", resp.Status)
	}
	var body errorBody
	json.NewDecoder(resp.Body).Decode(&body)
	if body.Message == "" || !strings.Contains(body.Message, "flat and()") {
		t.Errorf("refusal does not say what a scope may be: %q", body.Message)
	}
}

// It reaches nothing either way, so succeeding would report a change that changes nothing.
func TestARevokedTokensScopeCannotBeEdited(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	mintToken(t, s, c, "claude", "")
	c.task(`{"title":"Fix the tap","tags":["work"]}`)

	id := c.json(c.do("GET", "/api/tokens", ""))["tokens"].([]any)[0].(map[string]any)["id"].(string)
	if resp := c.do("DELETE", "/api/tokens/"+id, ""); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke = %s", resp.Status)
	}
	if resp := c.do("PATCH", "/api/tokens/"+id, `{"scope":"and(work)"}`); resp.StatusCode != http.StatusNotFound {
		t.Errorf("patching a revoked token = %s, want 404", resp.Status)
	}
}

// A credential must not manage credentials, which is why every token route is session-only.
func TestATokenCannotEditItsOwnScope(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	a := mintToken(t, s, c, "claude", "and(work)")

	id := c.json(c.do("GET", "/api/tokens", ""))["tokens"].([]any)[0].(map[string]any)["id"].(string)
	if resp := a.do("PATCH", "/api/tokens/"+id, `{"scope":""}`); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("a token widened itself: %s", resp.Status)
	}
}
