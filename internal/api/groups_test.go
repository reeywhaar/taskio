package api

import (
	"encoding/json"
	"net/http"
	"testing"
)

func groupNames(body map[string]any) []string {
	out := []string{}
	for _, row := range body["groups"].([]any) {
		out = append(out, row.(map[string]any)["name"].(string))
	}
	return out
}

func TestAGroupIsANameAndSomeTags(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	resp := c.do("POST", "/api/groups", `{"name":"Work","tags":["work","proxio"]}`)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create = %s", resp.Status)
	}
	made := c.json(resp)
	if made["name"] != "Work" {
		t.Errorf("name = %v", made["name"])
	}

	list := c.json(c.do("GET", "/api/groups", ""))
	if got := groupNames(list); len(got) != 1 || got[0] != "Work" {
		t.Fatalf("groups = %v", got)
	}
	tags := list["groups"].([]any)[0].(map[string]any)["tags"].([]any)
	if len(tags) != 2 || tags[0] != "proxio" || tags[1] != "work" {
		t.Errorf("tags = %v, want them sorted", tags)
	}
}

// Naming the group is often where somebody decides the tag exists.
func TestAGroupCanNameATagNothingCarries(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	resp := c.do("POST", "/api/groups", `{"name":"Someday","tags":["someday"]}`)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create = %s", resp.Status)
	}
	if got := c.json(c.do("GET", "/api/tags", ""))["tags"].([]any); len(got) != 0 {
		t.Errorf("the tag listing has %d in it — a group should not make a tag exist", len(got))
	}
}

func TestAGroupIsEditedWholeAndCanBeDeleted(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.json(c.do("POST", "/api/groups", `{"name":"Work","tags":["work"]}`))["id"].(string)

	resp := c.do("PATCH", "/api/groups/"+id, `{"name":"Day job","tags":["work","job"]}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch = %s", resp.Status)
	}
	after := c.json(resp)
	if after["name"] != "Day job" || len(after["tags"].([]any)) != 2 {
		t.Errorf("after = %v", after)
	}

	if resp := c.do("DELETE", "/api/groups/"+id, ""); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %s", resp.Status)
	}
	if got := groupNames(c.json(c.do("GET", "/api/groups", ""))); len(got) != 0 {
		t.Errorf("groups = %v, want none", got)
	}
}

// All is not stored, so a group with no tags would be a second one of it that does nothing.
func TestAGroupNeedsANameAndATag(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	for _, body := range []string{
		`{"name":"","tags":["work"]}`,
		`{"name":"Work","tags":[]}`,
	} {
		resp := c.do("POST", "/api/groups", body)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s = %s, want 400", body, resp.Status)
		}
		var out errorBody
		json.NewDecoder(resp.Body).Decode(&out)
		if out.Message == "" {
			t.Errorf("%s was refused without saying why", body)
		}
	}
}

func TestOneAccountCannotSeeAnothersGroups(t *testing.T) {
	s, st := newServerStore(t, nil)
	mine := signIn(t, s, st)
	id := mine.json(mine.do("POST", "/api/groups", `{"name":"Work","tags":["work"]}`))["id"].(string)

	account(t, st, "other", "a good password")
	theirs := newClient(t, s)
	theirs.do("POST", "/api/auth/login", `{"username":"other","password":"a good password"}`)

	if got := groupNames(theirs.json(theirs.do("GET", "/api/groups", ""))); len(got) != 0 {
		t.Errorf("another account's groups = %v", got)
	}
	if resp := theirs.do("DELETE", "/api/groups/"+id, ""); resp.StatusCode != http.StatusNotFound {
		t.Errorf("deleting another account's group = %s, want 404", resp.Status)
	}
}

// A scoped token must not learn tag names its scope does not reach, and a group is a list of
// tag names.
func TestATokenCannotReachGroups(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	a := mintToken(t, s, c, "claude", "")

	if resp := a.do("GET", "/api/groups", ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("a token listing groups = %s, want 401", resp.Status)
	}
}
