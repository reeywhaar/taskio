package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
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

/**
 * Tags come and go with the tasks that carry them, so a filter naming one that has gone still
 * answers. It used to be a refusal, on the grounds that a typo is indistinguishable from an
 * empty result — but an empty result is a true answer to the question asked, and the rule broke
 * filters nobody had changed.
 */
func TestASlugNothingCarriesMatchesNothing(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"Fix the tap","tags":["home"]}`)

	for query, want := range map[string]int{
		"?tags=and(home,chorse)":  0,
		"?tags=chorse":            0,
		"?tags=or(home,chorse)":   1,
		"?tags=and(home,not(ch))": 1,
		"?tags=not(chorse)":       1,
	} {
		resp := c.do("GET", "/api/tasks"+query, "")
		if resp.StatusCode != http.StatusOK {
			t.Errorf("%s = %s, want 200", query, resp.Status)
			continue
		}
		if got := len(c.json(resp)["tasks"].([]any)); got != want {
			t.Errorf("%s returned %d tasks, want %d", query, got, want)
		}
	}
}

// A malformed slug and a malformed expression are still refused: those are the caller's spelling
// of the question, not an answer about what exists.
func TestAMalformedFilterIsStillRefused(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"Fix the tap","tags":["home"]}`)

	for _, query := range []string{
		"?tags=and(home",
		"?tags=not(a,b)",
		"?tags=and(a!b)",
		"?tags=and(two%20words)",
		"?tags=and()",
	} {
		resp := c.do("GET", "/api/tasks"+query, "")
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s = %s, want 400", query, resp.Status)
			continue
		}
		var body errorBody
		json.NewDecoder(resp.Body).Decode(&body)
		if body.Code != CodeFilterInvalid {
			t.Errorf("%s gave code %q, want %q", query, body.Code, CodeFilterInvalid)
		}
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

// Forgiving about the title, exact about the tags and the description.
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

// The box is the only place a word can be typed without knowing it is a tag.
func TestSearchFindsATag(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"Call the plumber","tags":["home"]}`)
	c.task(`{"title":"Order the part"}`)

	got := titles(c.list("?q=home"))
	if len(got) != 1 || got[0] != "Call the plumber" {
		t.Errorf("home returned %v, want the tagged task alone", got)
	}
	// Part of a slug, because somebody typing into a box is halfway through a word.
	if got := titles(c.list("?q=hom")); len(got) != 1 || got[0] != "Call the plumber" {
		t.Errorf("hom returned %v", got)
	}
}

// A tag is a word somebody wrote on the task; a description merely contains it.
func TestATagOutranksADescriptionAndATitleOutranksBoth(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"Order the part","description":"Ask about the garden gate."}`)
	c.task(`{"title":"Call the plumber","tags":["garden"]}`)
	c.task(`{"title":"Garden waste collection"}`)

	got := titles(c.list("?q=garden"))
	want := []string{"Garden waste collection", "Call the plumber", "Order the part"}
	if len(got) != 3 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Errorf("garden returned %v, want %v", got, want)
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
	// Nothing says home any more, so nothing matches it. It is not a refusal: a tag stops
	// existing the moment its last task stops carrying it.
	if got := len(c.list("?tags=home")["tasks"].([]any)); got != 0 {
		t.Errorf("the old slug still names %d tasks", got)
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

// A search box is where a pasted id ends up — out of a transcript, a commit message, a chat.
func TestSearchFindsATaskByItsId(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.task(`{"title":"Fix the tap"}`)["id"].(string)
	c.task(`{"title":"Order the part"}`)

	for _, query := range []string{id, id[:4], strings.ToUpper(id), id[:4] + "-" + id[4:]} {
		got := titles(c.list("?q=" + url.QueryEscape(query)))
		if len(got) != 1 || got[0] != "Fix the tap" {
			t.Errorf("%q returned %v, want the task it names", query, got)
		}
	}
}

// Above every kind of word match: an id was not half-remembered, it was pasted.
func TestAnIdBeatsATitle(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.task(`{"title":"Fix the tap"}`)["id"].(string)
	// A title that contains the id as text, so both match and the ranking is what decides.
	c.task(`{"title":"Ticket ` + id + ` from the old tracker"}`)

	got := titles(c.list("?q=" + id))
	if len(got) != 2 || got[0] != "Fix the tap" {
		t.Errorf("searching an id returned %v, want the task it names first", got)
	}
}

// Four characters is the shortest thing that names a task anywhere else, and a word shorter than
// that is a word.
func TestAShortWordIsNotAnIdPrefix(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.task(`{"title":"Fix the tap"}`)["id"].(string)

	if got := titles(c.list("?q=" + id[:3])); len(got) != 0 {
		t.Errorf("three characters of an id returned %v, want nothing", got)
	}
}

// It has no meaning here: whoever writes it decides what it means, and nothing sorts by it.
func TestATaskCanCarryAColor(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	made := c.task(`{"title":"Fix the tap","color":"#2563EB"}`)
	if made["color"] != "#2563eb" {
		t.Errorf("color = %v, want it lowercased", made["color"])
	}
	id := made["id"].(string)

	if got := c.json(c.do("PATCH", "/api/tasks/"+id, `{"color":""}`))["color"]; got != "" {
		t.Errorf("after clearing it, color = %v", got)
	}
	// A task written without one has none rather than a default.
	if got := c.task(`{"title":"Order the part"}`)["color"]; got != "" {
		t.Errorf("a new task's color = %v, want none", got)
	}

	for _, bad := range []string{`"blue"`, `"#fff"`, `"#12345g"`} {
		resp := c.do("PATCH", "/api/tasks/"+id, `{"color":`+bad+`}`)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("color %s = %s, want 400", bad, resp.Status)
		}
	}
}

// A patch that does not mention it leaves it alone, like every other field.
func TestAPatchWithoutAColorLeavesIt(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.task(`{"title":"Fix the tap","color":"#16a34a"}`)["id"].(string)

	after := c.json(c.do("PATCH", "/api/tasks/"+id, `{"title":"Fix the other tap"}`))
	if after["color"] != "#16a34a" {
		t.Errorf("color = %v, want it kept", after["color"])
	}
}
