package api

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"

	"taskio/internal/config"
	"taskio/internal/store"
)

func newServer(t *testing.T, files fstest.MapFS) *Server {
	t.Helper()
	s, _ := newServerStore(t, files)
	return s
}

func newServerStore(t *testing.T, files fstest.MapFS) (*Server, *store.Store) {
	t.Helper()
	spa, err := NewSPA(files)
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	u, _ := url.Parse("https://taskio.example.com")
	cfg := &config.Config{PublicURL: u, Secure: true}
	return New(cfg, slog.New(slog.DiscardHandler), st, spa, NewDocs(nil, nil, u.String())), st
}

func do(t *testing.T, s *Server, method, path string, body string, hdr map[string]string) *http.Response {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
		r.ContentLength = 0
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
	}
	for k, v := range hdr {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w.Result()
}

func TestHealthzAnswers(t *testing.T) {
	s := newServer(t, nil)
	resp := do(t, s, "GET", "/healthz", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("healthz = %s", resp.Status)
	}
	var got map[string]any
	json.NewDecoder(resp.Body).Decode(&got)
	if got["ok"] != true {
		t.Errorf("body = %v", got)
	}
}

// Falling through to the SPA would reach a fetch as HTML it cannot parse.
func TestAnUnknownAPIPathIsJSONAndNotTheShell(t *testing.T) {
	s := newServer(t, fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte(`<div id="root">`)}})
	resp := do(t, s, "GET", "/api/nope", "", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %s", resp.Status)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("content type = %q", ct)
	}
	var got errorBody
	json.NewDecoder(resp.Body).Decode(&got)
	if got.Ok || got.Code != CodeNotFound || got.Message == "" {
		t.Errorf("body = %+v, want the refusal envelope with a sentence in it", got)
	}
}

// Its absence is a security property: the CSRF guard leans on it.
func TestNoCORSHeaderIsEverEmitted(t *testing.T) {
	s := newServer(t, fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("hi")}})
	for _, path := range []string{"/healthz", "/api/nope", "/", "/settings", "/index.html"} {
		resp := do(t, s, "GET", path, "", nil)
		if v := resp.Header.Get("Access-Control-Allow-Origin"); v != "" {
			t.Errorf("%s emitted Access-Control-Allow-Origin: %q", path, v)
		}
	}
}

func TestACrossSiteWriteIsRefused(t *testing.T) {
	s := newServer(t, nil)
	resp := do(t, s, "POST", "/api/tasks", `{}`, map[string]string{
		"Sec-Fetch-Site": "cross-site",
		"Content-Type":   "application/json",
	})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %s, want 403", resp.Status)
	}
}

// A DELETE legitimately carries no body.
func TestAWriteMustDeclareJSONOnlyWhenItHasABody(t *testing.T) {
	s := newServer(t, nil)

	resp := do(t, s, "POST", "/api/tasks", `{}`, map[string]string{"Content-Type": "text/plain"})
	if resp.StatusCode != http.StatusUnsupportedMediaType {
		t.Errorf("text/plain body = %s, want 415", resp.Status)
	}

	resp = do(t, s, "DELETE", "/api/tasks/ABCD", "", nil)
	if resp.StatusCode == http.StatusUnsupportedMediaType {
		t.Error("a bodiless DELETE was refused for not declaring a content type")
	}
}

func TestAContentTypeWithParametersIsStillJSON(t *testing.T) {
	s := newServer(t, nil)
	resp := do(t, s, "POST", "/api/tasks", `{}`, map[string]string{
		"Content-Type": "application/json; charset=utf-8",
	})
	if resp.StatusCode == http.StatusUnsupportedMediaType {
		t.Error("refused application/json because it carried a charset")
	}
}

// Tests must pass with no bundle, which keeps the image's two stages independent.
func TestAMissingBundleIsThePlaceholder(t *testing.T) {
	s := newServer(t, nil)
	resp := do(t, s, "GET", "/login", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %s", resp.Status)
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "has not been built") {
		t.Errorf("placeholder does not say why it is there: %q", string(body))
	}
}

// A refresh on any route but / would otherwise 404.
func TestARouteWithNoFileGetsItsShell(t *testing.T) {
	s, st := newServerStore(t, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("app")},
		"login.html": &fstest.MapFile{Data: []byte("login")},
	})
	c := signIn(t, s, st)
	for path, want := range map[string]string{
		"/":           "app",
		"/settings":   "app",
		"/t/8QW4TZ":   "app",
		"/invite/abc": "login",
		"/index.html": "app",
	} {
		resp := c.do("GET", path, "")
		body, _ := io.ReadAll(resp.Body)
		if string(body) != want {
			t.Errorf("%s served %q, want %q", path, string(body), want)
		}
	}
}

// The bug this is here for: the shell drew the whole interface for somebody who had never
// signed in, and every panel in it then failed.
func TestTheApplicationShellIsNotServedToAStranger(t *testing.T) {
	s := newServer(t, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("app")},
		"login.html": &fstest.MapFile{Data: []byte("login")},
		"admin.html": &fstest.MapFile{Data: []byte("admin")},
	})
	for _, path := range []string{"/", "/settings", "/t/8qw4tz", "/admin"} {
		resp := do(t, s, "GET", path, "", nil)
		if resp.StatusCode != http.StatusFound {
			t.Errorf("%s = %s, want a redirect", path, resp.Status)
			continue
		}
		if to := resp.Header.Get("Location"); to != "/login" {
			t.Errorf("%s redirected to %q", path, to)
		}
		if cc := resp.Header.Get("Cache-Control"); cc != "no-store" {
			t.Errorf("%s redirect is cacheable: %q", path, cc)
		}
	}
}

// Redirecting these would leave nowhere to sign in, and an invitation is how an account starts.
func TestTheSignInPageAndInvitationsAreReachableSignedOut(t *testing.T) {
	s := newServer(t, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("app")},
		"login.html": &fstest.MapFile{Data: []byte("login")},
	})
	for _, path := range []string{"/login", "/invite/abc"} {
		resp := do(t, s, "GET", path, "", nil)
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK || string(body) != "login" {
			t.Errorf("%s = %s %q", path, resp.Status, string(body))
		}
	}
}

// Otherwise the sign-in page has no stylesheet, and the redirect is to an unstyled one.
func TestTheBundleIsServedToAStranger(t *testing.T) {
	s := newServer(t, fstest.MapFS{
		"login.html":         &fstest.MapFile{Data: []byte("login")},
		"assets/login-x.css": &fstest.MapFile{Data: []byte("body{}")},
		"favicon.ico":        &fstest.MapFile{Data: []byte("icon")},
	})
	for _, path := range []string{"/assets/login-x.css", "/favicon.ico"} {
		if resp := do(t, s, "GET", path, "", nil); resp.StatusCode != http.StatusOK {
			t.Errorf("%s = %s", path, resp.Status)
		}
	}
}

// A bookmark from before, or a tab left open through a sign-in in another one.
func TestSignedInTheSignInPageSendsYouToTheApplication(t *testing.T) {
	s, st := newServerStore(t, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("app")},
		"login.html": &fstest.MapFile{Data: []byte("login")},
	})
	c := signIn(t, s, st)

	resp := c.do("GET", "/login", "")
	if resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != "/" {
		t.Errorf("/login signed in = %s to %q", resp.Status, resp.Header.Get("Location"))
	}

	// Not /invite, which is how somebody joins on a machine already signed in as somebody else.
	if resp := c.do("GET", "/invite/abc", ""); resp.StatusCode != http.StatusOK {
		t.Errorf("/invite signed in = %s, want the page", resp.Status)
	}
}
