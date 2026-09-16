package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"
)

func (c *client) task(body string) map[string]any {
	c.t.Helper()
	resp := c.do("POST", "/api/tasks", body)
	if resp.StatusCode != http.StatusCreated {
		c.t.Fatalf("create = %s", resp.Status)
	}
	return c.json(resp)
}

func (c *client) list(query string) map[string]any {
	c.t.Helper()
	resp := c.do("GET", "/api/tasks"+query, "")
	if resp.StatusCode != http.StatusOK {
		c.t.Fatalf("list%s = %s", query, resp.Status)
	}
	return c.json(resp)
}

func titles(body map[string]any) []string {
	var out []string
	for _, row := range body["tasks"].([]any) {
		out = append(out, row.(map[string]any)["title"].(string))
	}
	return out
}

func TestWritingATaskAndReadingItBack(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	made := c.task(`{"title":"Fix the tap","description":"It drips.","tags":["home","repair"]}`)
	id := made["id"].(string)
	if len(id) != 8 {
		t.Errorf("id = %q, want eight characters", id)
	}
	if made["status"] != "todo" {
		t.Errorf("status = %v", made["status"])
	}

	got := c.json(c.do("GET", "/api/tasks/"+id, ""))
	if got["title"] != "Fix the tap" {
		t.Errorf("task = %v", got)
	}
	tags := got["tags"].([]any)
	if len(tags) != 2 || tags[0] != "home" || tags[1] != "repair" {
		t.Errorf("tags = %v", tags)
	}
}

// A tag comes into existence by being written onto a task; there is no create-a-tag call.
func TestATagExistsBecauseATaskCarriesIt(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	if body := c.json(c.do("GET", "/api/tags", "")); len(body["tags"].([]any)) != 0 {
		t.Fatalf("a fresh account already has tags: %v", body)
	}
	c.task(`{"title":"Fix the tap","tags":["Home Repairs"]}`)

	body := c.json(c.do("GET", "/api/tags", ""))
	list := body["tags"].([]any)
	if len(list) != 1 {
		t.Fatalf("tags = %v", body)
	}
	// Uppercase and spaces are folded rather than refused.
	if list[0].(map[string]any)["slug"] != "home-repairs" {
		t.Errorf("slug = %v", list[0])
	}
}

// Any unambiguous prefix of four or more characters works where the whole id does.
func TestAPrefixNamesATask(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.task(`{"title":"Fix the tap"}`)["id"].(string)

	for _, ref := range []string{id, id[:4], id[:6], upperOf(id[:5])} {
		resp := c.do("GET", "/api/tasks/"+ref, "")
		if resp.StatusCode != http.StatusOK {
			t.Errorf("%q = %s", ref, resp.Status)
		}
	}
	if resp := c.do("GET", "/api/tasks/"+id[:3], ""); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("a three-character prefix = %s, want 400", resp.Status)
	}
}

func upperOf(s string) string {
	out := []byte(s)
	for i := range out {
		if out[i] >= 'a' && out[i] <= 'z' {
			out[i] -= 'a' - 'A'
		}
	}
	return string(out)
}

// Refused rather than treated as matching nothing: a typo would otherwise be indistinguishable
// from an empty result.
func TestAnUnknownSlugInAFilterIsRefused(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"Fix the tap","tags":["home"]}`)

	resp := c.do("GET", "/api/tasks?tags=and(home,chorse)", "")
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %s, want 400", resp.Status)
	}
	var body errorBody
	json.NewDecoder(resp.Body).Decode(&body)
	if body.Code != CodeTagUnknown {
		t.Errorf("code = %q", body.Code)
	}
	if !contains(body.Message, "chorse") {
		t.Errorf("message does not name the tag: %q", body.Message)
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (len(sub) == 0 || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

// The whole grammar, which is what the API is for even though the screen draws only an and().
func TestTheFilterNarrowsTheList(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"Fix the tap","tags":["home","repair"]}`)
	c.task(`{"title":"Call the plumber","tags":["home"]}`)
	c.task(`{"title":"Write the report","tags":["work"]}`)
	c.task(`{"title":"Nothing in particular"}`)

	for query, want := range map[string]int{
		"?tags=home":                      2,
		"?tags=and(home,repair)":          1,
		"?tags=or(work,repair)":           2,
		"?tags=not(home)":                 2,
		"?tags=or(and(home,repair),work)": 2,
		"":                                4,
	} {
		body := c.list(query)
		if got := len(body["tasks"].([]any)); got != want {
			t.Errorf("%q returned %d tasks (%v), want %d", query, got, titles(body), want)
		}
	}
}

// A task with no tags matches not(x), which falls out of NOT EXISTS and is the case an
// anti-join gets wrong.
func TestATaskWithNoTagsMatchesANegation(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"Untagged"}`)
	c.task(`{"title":"Tagged","tags":["home"]}`)

	body := c.list("?tags=not(home)")
	if got := titles(body); len(got) != 1 || got[0] != "Untagged" {
		t.Errorf("not(home) returned %v", got)
	}
}

func TestStatusDefaultsToTodo(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.task(`{"title":"Fix the tap"}`)["id"].(string)
	c.task(`{"title":"Call the plumber"}`)
	c.do("POST", "/api/tasks/"+id+"/done", "")

	if got := len(c.list("")["tasks"].([]any)); got != 1 {
		t.Errorf("default list has %d tasks, want the open one only", got)
	}
	if got := len(c.list("?status=done")["tasks"].([]any)); got != 1 {
		t.Error("the done list is empty")
	}
	if got := len(c.list("?status=all")["tasks"].([]any)); got != 2 {
		t.Error("status=all did not return both")
	}
}

// Two agents finishing the same thing is not an error, and re-stamping would reset the sweep.
func TestMarkingAnAlreadyDoneTaskIsASuccess(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.task(`{"title":"Fix the tap"}`)["id"].(string)

	first := c.json(c.do("POST", "/api/tasks/"+id+"/done", ""))
	second := c.json(c.do("POST", "/api/tasks/"+id+"/done", ""))
	if first["done_at"] != second["done_at"] {
		t.Errorf("done_at moved on the second call: %v then %v", first["done_at"], second["done_at"])
	}
}

// updated_at means last changed, not last saved.
func TestSavingWithoutChangingAnythingDoesNotMoveUpdatedAt(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	made := c.task(`{"title":"Fix the tap","description":"It drips."}`)
	id := made["id"].(string)

	before := st.Changes()
	again := c.json(c.do("PATCH", "/api/tasks/"+id, `{"title":"Fix the tap"}`))

	if again["updated_at"] != made["updated_at"] {
		t.Errorf("updated_at moved: %v then %v", made["updated_at"], again["updated_at"])
	}
	if st.Changes() != before {
		t.Error("a no-op save marked the database changed, which would schedule a backup")
	}
}

// Absent leaves a field alone and empty clears it.
func TestPatchPointers(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.task(`{"title":"Fix the tap","description":"It drips.","tags":["home"]}`)["id"].(string)

	got := c.json(c.do("PATCH", "/api/tasks/"+id, `{"description":""}`))
	if got["title"] != "Fix the tap" {
		t.Error("clearing the description changed the title")
	}
	if got["description"] != "" {
		t.Errorf("description = %v, want it cleared", got["description"])
	}
	if len(got["tags"].([]any)) != 1 {
		t.Error("an absent tags field cleared the tags")
	}
}

// The done list is a record of what happened, so it is ordered by when things were finished.
func TestTheDoneListIsOrderedByWhenThingsWereDone(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	// Driven rather than slept through: timestamps are Unix seconds, so two calls in the same
	// test would otherwise tie and the ordering under test would never be exercised.
	now := time.Date(2026, 9, 16, 4, 0, 0, 0, time.UTC)
	st.SetClock(func() time.Time { return now })

	old := c.task(`{"title":"Written in March"}`)["id"].(string)
	now = now.Add(time.Hour)
	recent := c.task(`{"title":"Written yesterday"}`)["id"].(string)

	// Finish the older one last.
	now = now.Add(time.Hour)
	c.do("POST", "/api/tasks/"+recent+"/done", "")
	now = now.Add(time.Hour)
	c.do("POST", "/api/tasks/"+old+"/done", "")

	got := titles(c.list("?status=done"))
	if len(got) != 2 || got[0] != "Written in March" {
		t.Errorf("done list = %v, want the most recently finished first", got)
	}
}

func TestACursorFromOneOrderingIsRefusedByTheOther(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	for i := 0; i < 3; i++ {
		c.task(fmt.Sprintf(`{"title":"Task %d"}`, i))
	}
	body := c.list("?limit=1")
	cursor, ok := body["next_cursor"].(string)
	if !ok {
		t.Fatalf("no cursor on a truncated page: %v", body)
	}
	if resp := c.do("GET", "/api/tasks?limit=1&cursor="+cursor, ""); resp.StatusCode != http.StatusOK {
		t.Errorf("the cursor was refused by its own ordering: %s", resp.Status)
	}
	resp := c.do("GET", "/api/tasks?status=done&cursor="+cursor, "")
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("a live cursor was accepted by the done list: %s", resp.Status)
	}
}

func TestTotalCountsMatchesRatherThanThePage(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	for i := 0; i < 5; i++ {
		c.task(fmt.Sprintf(`{"title":"Task %d"}`, i))
	}
	body := c.list("?limit=2")
	if len(body["tasks"].([]any)) != 2 {
		t.Fatalf("page = %v", titles(body))
	}
	if body["total"].(float64) != 5 {
		t.Errorf("total = %v, want 5", body["total"])
	}
}

// Forgiving about the title, exact about the description.
func TestSearch(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"Call the plumber"}`)
	c.task(`{"title":"Order the part"}`)
	c.task(`{"title":"Fix the tap","description":"The washer is perished."}`)

	for query, want := range map[string]string{
		"?q=plumb":   "Call the plumber",
		"?q=plmb":    "Call the plumber",
		"?q=plumebr": "Call the plumber",
		"?q=washer":  "Fix the tap",
	} {
		got := titles(c.list(query))
		if len(got) == 0 || got[0] != want {
			t.Errorf("%q returned %v, want %q first", query, got, want)
		}
	}

	// Ranked, so the better match leads.
	if got := titles(c.list("?q=tap")); len(got) == 0 || got[0] != "Fix the tap" {
		t.Errorf("tap returned %v", got)
	}
	// A search turns pagination off: a score is not a stable sort key.
	if _, ok := c.list("?q=the&limit=1")["next_cursor"]; ok {
		t.Error("a search answered with a cursor")
	}
}

func TestOneAccountCannotSeeAnothersTasks(t *testing.T) {
	s, st := newServerStore(t, nil)
	mine := signIn(t, s, st)
	id := mine.task(`{"title":"Mine"}`)["id"].(string)

	account(t, st, "other", "a good password")
	theirs := newClient(t, s)
	theirs.do("POST", "/api/auth/login", `{"username":"other","password":"a good password"}`)

	if resp := theirs.do("GET", "/api/tasks/"+id, ""); resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %s, want 404 — indistinguishable from a task that never existed", resp.Status)
	}
	if got := len(theirs.list("")["tasks"].([]any)); got != 0 {
		t.Errorf("another account's list has %d tasks in it", got)
	}
}

// Renaming onto a slug already in use is a merge rather than a conflict.
func TestRenamingATagMerges(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"One","tags":["home"]}`)
	c.task(`{"title":"Two","tags":["house"]}`)

	resp := c.do("PATCH", "/api/tags/home", `{"slug":"house"}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("rename = %s", resp.Status)
	}
	if got := c.json(resp)["tasks"].(float64); got != 1 {
		t.Errorf("touched %v tasks, want 1", got)
	}
	if got := len(c.list("?tags=house")["tasks"].([]any)); got != 2 {
		t.Errorf("after the merge house has %d tasks", got)
	}
	if resp := c.do("GET", "/api/tasks?tags=home", ""); resp.StatusCode != http.StatusBadRequest {
		t.Error("the old slug still exists")
	}
}

// Not a delete of anything: the tag stops existing because nothing says it any more.
func TestRemovingATagLeavesTheTasks(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"One","tags":["home","repair"]}`)

	resp := c.do("DELETE", "/api/tags/home", "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("remove = %s", resp.Status)
	}
	if got := len(c.list("")["tasks"].([]any)); got != 1 {
		t.Error("removing a tag removed the task")
	}
	if got := len(c.list("?tags=repair")["tasks"].([]any)); got != 1 {
		t.Error("removing one tag took the other")
	}
}
