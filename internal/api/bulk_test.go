package api

import (
	"fmt"
	"net/http"
	"slices"
	"testing"
)

// tagsOf reads one task back, because a bulk call answers with a count rather than the rows.
func (c *client) tagsOf(id string) []string {
	c.t.Helper()
	var out []string
	for _, slug := range c.json(c.do("GET", "/api/tasks/"+id, ""))["tags"].([]any) {
		out = append(out, slug.(string))
	}
	return out
}

func (c *client) statusOf(id string) string {
	c.t.Helper()
	return c.json(c.do("GET", "/api/tasks/"+id, ""))["status"].(string)
}

// A session carries no scope, which is the ordinary case and the one that panicked: the slugs a
// scope protects were read off a nil filter without asking whether there was one.
func TestBulkTaggingFromASession(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	first := c.task(`{"title":"Fix the tap","tags":["home"]}`)["id"].(string)
	second := c.task(`{"title":"Renew the passport","tags":["home"]}`)["id"].(string)

	body := fmt.Sprintf(`{"ids":[%q,%q],"add":["errands"],"remove":["home"]}`, first, second)
	resp := c.do("POST", "/api/tasks/bulk/tags", body)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("bulk tags = %s", resp.Status)
	}

	for _, id := range []string{first, second} {
		got := c.tagsOf(id)
		if !slices.Equal(got, []string{"errands"}) {
			t.Errorf("%s tags = %v, want just errands", id, got)
		}
	}
}

func TestBulkFinishAndReopen(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	first := c.task(`{"title":"Fix the tap"}`)["id"].(string)
	second := c.task(`{"title":"Renew the passport"}`)["id"].(string)
	ids := fmt.Sprintf(`{"ids":[%q,%q]}`, first, second)

	if resp := c.do("POST", "/api/tasks/bulk/done", ids); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("bulk done = %s", resp.Status)
	}
	for _, id := range []string{first, second} {
		if got := c.statusOf(id); got != "done" {
			t.Errorf("%s = %s after finishing", id, got)
		}
	}

	if resp := c.do("POST", "/api/tasks/bulk/todo", ids); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("bulk todo = %s", resp.Status)
	}
	for _, id := range []string{first, second} {
		if got := c.statusOf(id); got != "todo" {
			t.Errorf("%s = %s after reopening", id, got)
		}
	}
}

func TestBulkDelete(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	first := c.task(`{"title":"Fix the tap"}`)["id"].(string)
	second := c.task(`{"title":"Renew the passport"}`)["id"].(string)

	body := fmt.Sprintf(`{"ids":[%q]}`, first)
	if resp := c.do("POST", "/api/tasks/bulk/delete", body); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("bulk delete = %s", resp.Status)
	}
	if resp := c.do("GET", "/api/tasks/"+first, ""); resp.StatusCode != http.StatusNotFound {
		t.Errorf("deleted task = %s, want 404", resp.Status)
	}
	if resp := c.do("GET", "/api/tasks/"+second, ""); resp.StatusCode != http.StatusOK {
		t.Errorf("the one not named = %s", resp.Status)
	}
}

// A scoped token may not take a task out of its own reach, so its own slugs survive a remove.
func TestBulkTaggingCannotRemoveATokensOwnScope(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	a := mintToken(t, s, c, "claude", "and(home)")

	id := c.task(`{"title":"Fix the tap","tags":["home","repair"]}`)["id"].(string)

	body := fmt.Sprintf(`{"ids":[%q],"remove":["home","repair"]}`, id)
	if resp := a.do("POST", "/api/tasks/bulk/tags", body); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("bulk tags = %s", resp.Status)
	}

	if got := c.tagsOf(id); !slices.Equal(got, []string{"home"}) {
		t.Errorf("tags = %v, want home kept and repair gone", got)
	}
}
