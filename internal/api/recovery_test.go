package api

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"taskio/internal/store"
)

// link mints one the way an administrator would, and hands back the token in it.
func link(t *testing.T, st *store.Store, principalID string) string {
	t.Helper()
	_, token, err := st.CreateRecoveryLink(context.Background(), principalID, "")
	if err != nil {
		t.Fatal(err)
	}
	return token
}

/**
 * The whole point of the endpoint: it must not answer differently for an address somebody has
 * and one nobody has. Anything else turns the forgotten-password form into a way to ask this
 * instance who has an account here.
 */
func TestAskingForARecoveryLinkSaysNothingAboutTheAddress(t *testing.T) {
	s, st := newServerStore(t, nil)
	signIn(t, s, st)
	c := newClient(t, s)

	// Both answers are the same answer, and neither says whether the address is one of ours.
	for _, body := range []string{
		`{"email":"nobody@example.com"}`,
		`{"email":"misha@example.com"}`,
	} {
		resp := c.do("POST", "/api/auth/recoveries", body)
		if resp.StatusCode != http.StatusNoContent {
			t.Errorf("asking with %s = %s, want 204", body, resp.Status)
		}
	}
}

func TestAnAddressIsRequired(t *testing.T) {
	s, _ := newServerStore(t, nil)
	c := newClient(t, s)
	if resp := c.do("POST", "/api/auth/recoveries", `{"email":"  "}`); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("asking with nothing = %s, want 400", resp.Status)
	}
}

// Four states a person acts on differently, so the page is told which one it is looking at.
func TestALinkSaysWhatStateItIsIn(t *testing.T) {
	s, st := newServerStore(t, nil)
	p := account(t, st, "misha", "a good password")
	c := newClient(t, s)

	token := link(t, st, p.ID)
	body := c.json(c.do("GET", "/api/auth/recoveries/"+token, ""))
	if body["username"] != "misha" {
		t.Errorf("username = %v", body["username"])
	}
	if body["usable"] != true || body["used"] != false {
		t.Errorf("a fresh link = %v", body)
	}

	if resp := c.do("POST", "/api/auth/recoveries/"+token+"/accept",
		`{"password":"another good password"}`); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("accept = %s", resp.Status)
	}

	body = c.json(c.do("GET", "/api/auth/recoveries/"+token, ""))
	if body["usable"] != false || body["used"] != true {
		t.Errorf("a spent link = %v", body)
	}
}

func TestAnUnknownLinkIsNotFound(t *testing.T) {
	s, _ := newServerStore(t, nil)
	c := newClient(t, s)
	if resp := c.do("GET", "/api/auth/recoveries/nothing-like-a-token", ""); resp.StatusCode != http.StatusNotFound {
		t.Errorf("an unknown token = %s, want 404", resp.Status)
	}
}

/**
 * Spending a link sets the password and signs out everybody who was already in — the likeliest
 * reason to be here at all is that somebody else has a session.
 *
 * It does not sign the caller in. The account existed before this, the link may have reached the
 * wrong person, and typing the new password at the login form once is the cheapest confirmation
 * that the right one has it.
 */
func TestSpendingALinkMovesThePasswordAndEndsEverySession(t *testing.T) {
	s, st := newServerStore(t, nil)
	signedIn := signIn(t, s, st)
	p, err := st.PrincipalNamed(context.Background(), "misha")
	if err != nil {
		t.Fatal(err)
	}

	c := newClient(t, s)
	resp := c.do("POST", "/api/auth/recoveries/"+link(t, st, p.ID)+"/accept",
		`{"password":"a different good password"}`)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("accept = %s", resp.Status)
	}
	if c.cookie != nil {
		t.Error("recovering signed the caller in, which proves nothing about who they are")
	}

	if resp := signedIn.do("GET", "/api/auth/me", ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("the session that was already open = %s, want 401", resp.Status)
	}
	if resp := c.do("POST", "/api/auth/login",
		`{"username":"misha","password":"a different good password"}`); resp.StatusCode != http.StatusNoContent {
		t.Errorf("signing in with the new password = %s", resp.Status)
	}
	if resp := c.do("POST", "/api/auth/login",
		`{"username":"misha","password":"a good password"}`); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("signing in with the old password = %s, want 401", resp.Status)
	}
}

func TestALinkWorksOnce(t *testing.T) {
	s, st := newServerStore(t, nil)
	p := account(t, st, "misha", "a good password")
	c := newClient(t, s)
	token := link(t, st, p.ID)

	if resp := c.do("POST", "/api/auth/recoveries/"+token+"/accept",
		`{"password":"another good password"}`); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("first = %s", resp.Status)
	}
	if resp := c.do("POST", "/api/auth/recoveries/"+token+"/accept",
		`{"password":"a third good password"}`); resp.StatusCode != http.StatusConflict {
		t.Errorf("second = %s, want 409", resp.Status)
	}
}

// The path for an instance that can send no mail at all, which is most self-hosted ones.
func TestAnAdministratorCanIssueALink(t *testing.T) {
	s, st := newServerStore(t, nil)
	user := signIn(t, s, st)
	p, err := st.PrincipalNamed(context.Background(), "misha")
	if err != nil {
		t.Fatal(err)
	}

	if resp := user.do("POST", "/api/admin/users/"+p.ID+"/recovery", ""); resp.StatusCode != http.StatusForbidden {
		t.Errorf("as a user = %s, want 403", resp.Status)
	}

	admin := adminClient(t, s, st)
	resp := admin.do("POST", "/api/admin/users/"+p.ID+"/recovery", "")
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("as an admin = %s", resp.Status)
	}
	body := admin.json(resp)
	url, _ := body["url"].(string)
	if !strings.Contains(url, "/recover/") {
		t.Fatalf("url = %v", body["url"])
	}
	if body["username"] != "misha" {
		t.Errorf("username = %v", body["username"])
	}

	// Issuing one changes nothing: the account carries on with the password it has.
	if resp := user.do("GET", "/api/auth/me", ""); resp.StatusCode != http.StatusOK {
		t.Errorf("the account's own session = %s, want it untouched", resp.Status)
	}

	// And the link in the reply is the one that works.
	token := url[strings.LastIndex(url, "/")+1:]
	c := newClient(t, s)
	if resp := c.do("POST", "/api/auth/recoveries/"+token+"/accept",
		`{"password":"another good password"}`); resp.StatusCode != http.StatusNoContent {
		t.Errorf("the issued link = %s", resp.Status)
	}
}

// The login form asks before it offers to mail anything, because an instance with no relay
// offering to send a link is a form that says "check your inbox" and is lying.
func TestTheLoginFormIsToldWhetherMailCanBeSent(t *testing.T) {
	s, _ := newServerStore(t, nil)
	c := newClient(t, s)
	body := c.json(c.do("GET", "/api/auth/instance", ""))
	if body["recovery"] != false {
		t.Errorf("with no relay = %v", body)
	}
}
