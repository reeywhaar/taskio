package api

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"taskio/internal/store"
)

func adminClient(t *testing.T, s *Server, st *store.Store) *client {
	t.Helper()
	ctx := context.Background()
	if _, err := st.CreatePrincipal(ctx, "boss", "a good password", store.RoleAdmin); err != nil {
		t.Fatal(err)
	}
	c := newClient(t, s)
	if resp := c.do("POST", "/api/auth/login", `{"username":"boss","password":"a good password"}`); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("login = %s", resp.Status)
	}
	return c
}

func TestAdminRoutesAreAnAdministrators(t *testing.T) {
	s, st := newServerStore(t, nil)
	user := signIn(t, s, st)

	for _, path := range []string{"/api/admin/users", "/api/admin/relay", "/api/admin/limits"} {
		if resp := user.do("GET", path, ""); resp.StatusCode != http.StatusForbidden {
			t.Errorf("%s as a user = %s, want 403", path, resp.Status)
		}
	}

	admin := adminClient(t, s, st)
	for _, path := range []string{"/api/admin/users", "/api/admin/relay", "/api/admin/limits"} {
		if resp := admin.do("GET", path, ""); resp.StatusCode != http.StatusOK {
			t.Errorf("%s as an admin = %s", path, resp.Status)
		}
	}
}

// The relay's password never comes back out: readable by anything that can read a response, for
// no gain, since the form does not need it to save a change.
func TestTheRelayPasswordNeverComesBack(t *testing.T) {
	s, st := newServerStore(t, nil)
	admin := adminClient(t, s, st)

	body := `{"host":"smtp.example.com","port":587,"security":"starttls",
	          "username":"misha","password":"hunter2",
	          "from_address":"taskio@example.com","from_name":"taskio"}`
	if resp := admin.do("PUT", "/api/admin/relay", body); resp.StatusCode != http.StatusOK {
		t.Fatalf("save = %s", resp.Status)
	}

	got := readAll(t, admin.do("GET", "/api/admin/relay", ""))
	if strings.Contains(got, "hunter2") {
		t.Fatal("the relay's password is in the response")
	}
	if !strings.Contains(got, `"password_set":true`) {
		t.Errorf("the form cannot tell whether a password is stored: %s", got)
	}
}

// An empty password keeps the stored one, which is what lets a port be corrected without
// retyping a credential the form was never given.
func TestSavingWithAnEmptyPasswordKeepsTheStoredOne(t *testing.T) {
	s, st := newServerStore(t, nil)
	admin := adminClient(t, s, st)
	ctx := context.Background()

	admin.do("PUT", "/api/admin/relay", `{"host":"smtp.example.com","port":587,
	   "security":"starttls","username":"misha","password":"hunter2",
	   "from_address":"taskio@example.com","from_name":""}`)

	admin.do("PUT", "/api/admin/relay", `{"host":"smtp.example.com","port":465,
	   "security":"implicit","username":"misha","password":"",
	   "from_address":"taskio@example.com","from_name":""}`)

	relay, err := st.Relay(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if relay.Password != "hunter2" {
		t.Errorf("password = %q, want the stored one kept", relay.Password)
	}
	if relay.Port != 465 {
		t.Errorf("port = %d, want the correction applied", relay.Port)
	}
}

// Accepting one without the other would make "this relay needs no authentication"
// indistinguishable from "somebody left the field empty", and the second is far likelier.
func TestAUsernameWithoutAPasswordIsRefused(t *testing.T) {
	s, st := newServerStore(t, nil)
	admin := adminClient(t, s, st)

	resp := admin.do("PUT", "/api/admin/relay", `{"host":"smtp.example.com","port":587,
	   "security":"starttls","username":"misha","password":"",
	   "from_address":"taskio@example.com","from_name":""}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %s, want 400", resp.Status)
	}
}

// A password crossing the network in the clear is not a choice somebody should be able to make
// by accident.
func TestThereIsNoUnencryptedOption(t *testing.T) {
	s, st := newServerStore(t, nil)
	admin := adminClient(t, s, st)

	resp := admin.do("PUT", "/api/admin/relay", `{"host":"smtp.example.com","port":25,
	   "security":"none","username":"","password":"",
	   "from_address":"taskio@example.com","from_name":""}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %s, want 400", resp.Status)
	}
}

// Both caps are instance settings rather than constants, and the refusal names the number.
func TestTheAssetLimitIsTheInstancesToSet(t *testing.T) {
	s, st := newServerStore(t, nil)
	admin := adminClient(t, s, st)
	user := signIn(t, s, st)

	if resp := admin.do("PUT", "/api/admin/limits",
		`{"asset_max_bytes":64,"account_quota_bytes":1024}`); resp.StatusCode != http.StatusOK {
		t.Fatalf("set limits = %s", resp.Status)
	}

	resp := user.upload("image/png", onePixel(t, 40))
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %s, want 413", resp.Status)
	}
	got := user.json(resp)
	if got["code"] != CodeAssetTooLarge {
		t.Errorf("code = %v", got["code"])
	}
	if msg, _ := got["message"].(string); !strings.Contains(msg, "64") {
		t.Errorf("the refusal does not name the limit: %q", msg)
	}
}

// One image cannot be allowed to be larger than a whole account's quota.
func TestTheLimitsHaveToMakeSenseTogether(t *testing.T) {
	s, st := newServerStore(t, nil)
	admin := adminClient(t, s, st)

	resp := admin.do("PUT", "/api/admin/limits",
		`{"asset_max_bytes":2048,"account_quota_bytes":1024}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %s, want 400", resp.Status)
	}
}
