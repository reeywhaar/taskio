package api

import (
	"net/http"
	"testing"
)

// slugs reads a tag listing in the order it came back in, which is the point of these.
func slugs(body map[string]any) []string {
	out := []string{}
	for _, row := range body["tags"].([]any) {
		out = append(out, row.(map[string]any)["slug"].(string))
	}
	return out
}

func equal(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

// Dragged first, then the rest alphabetically.
func TestTagsComeBackInTheOrderTheyWereDraggedInto(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"One","tags":["alpha","beta","gamma"]}`)

	if got := slugs(c.json(c.do("GET", "/api/tags", ""))); !equal(got, []string{"alpha", "beta", "gamma"}) {
		t.Fatalf("unarranged = %v, want them alphabetical", got)
	}

	if resp := c.do("PUT", "/api/tags/order", `{"slugs":["gamma","beta"]}`); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("order = %s", resp.Status)
	}
	// alpha was not named, so it sorts after the two that were.
	if got := slugs(c.json(c.do("GET", "/api/tags", ""))); !equal(got, []string{"gamma", "beta", "alpha"}) {
		t.Errorf("arranged = %v", got)
	}
}

// A tag goes out of use whenever its last task is finished off.
func TestAnArrangementKeepsASlugNothingCarries(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"One","tags":["alpha","beta"]}`)

	if resp := c.do("PUT", "/api/tags/order", `{"slugs":["beta","retired","alpha"]}`); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("order = %s", resp.Status)
	}
	// The listing is still what tasks carry; the arrangement simply has a row nothing matches.
	if got := slugs(c.json(c.do("GET", "/api/tags", ""))); !equal(got, []string{"beta", "alpha"}) {
		t.Errorf("listing = %v", got)
	}
	// And when a task carries it again, it is where it was left rather than at the end.
	c.task(`{"title":"Two","tags":["retired"]}`)
	if got := slugs(c.json(c.do("GET", "/api/tags", ""))); !equal(got, []string{"beta", "retired", "alpha"}) {
		t.Errorf("after it came back = %v", got)
	}
}

func TestAnArrangementRefusesSomethingThatIsNotATag(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"One","tags":["alpha"]}`)

	if resp := c.do("PUT", "/api/tags/order", `{"slugs":["alpha","and"]}`); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("arranging a reserved word = %s, want 400", resp.Status)
	}
}

// It is an arrangement of somebody's screen, not something a program needs to work the list.
func TestATokenCannotArrangeTags(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	a := mintToken(t, s, c, "claude", "")

	if resp := a.do("PUT", "/api/tags/order", `{"slugs":["alpha"]}`); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("a token arranging tags = %s, want 401", resp.Status)
	}
}

// taskTags reads the tags off a task body, in the order they came back in.
func taskTags(body map[string]any) []string {
	out := []string{}
	for _, row := range body["tags"].([]any) {
		out = append(out, row.(string))
	}
	return out
}

// The bug: a tag invented today sorted alphabetically among the ones nobody had dragged, so
// "bug" landed between "ui" and "feature" in the middle of an arrangement somebody had made.
func TestANewTagArrivesAtTheEndOfTheArrangement(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"One","tags":["alpha","delta","echo"]}`)

	// Only one of the three is dragged, which is the shape the bug was reported in: an
	// arrangement at the front, and everything else falling in behind it by name.
	if resp := c.do("PUT", "/api/tags/order", `{"slugs":["echo"]}`); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("order = %s", resp.Status)
	}
	if got := slugs(c.json(c.do("GET", "/api/tags", ""))); !equal(got, []string{"echo", "alpha", "delta"}) {
		t.Fatalf("before the new tag = %v", got)
	}

	// "bug" sorts ahead of "delta" by name and behind all three by age, and age is what counts.
	c.task(`{"title":"Two","tags":["bug"]}`)
	if got := slugs(c.json(c.do("GET", "/api/tags", ""))); !equal(got, []string{"echo", "alpha", "delta", "bug"}) {
		t.Errorf("after a new tag = %v", got)
	}
}

// An account that has never dragged anything still gets them in the order they were made.
func TestTagsKeepTheOrderTheyWereMadeIn(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"One","tags":["zulu","alpha"]}`)
	c.task(`{"title":"Two","tags":["mike"]}`)

	if got := slugs(c.json(c.do("GET", "/api/tags", ""))); !equal(got, []string{"zulu", "alpha", "mike"}) {
		t.Errorf("unarranged = %v", got)
	}
}

// New means the account has not got the tag, not that the arrangement has not named it. Every
// tag was unnamed before the arrangement started naming them all, and reading those as new would
// send a tag somebody had used for months to the end the next time they wrote it.
func TestWritingAnOldTagLeavesItWhereItIs(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"One","tags":["alpha","delta","echo"]}`)

	if resp := c.do("PUT", "/api/tags/order", `{"slugs":["echo"]}`); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("order = %s", resp.Status)
	}

	// alpha is in use and unnamed, which is every tag on every account that never dragged one.
	c.task(`{"title":"Two","tags":["alpha"]}`)
	if got := slugs(c.json(c.do("GET", "/api/tags", ""))); !equal(got, []string{"echo", "alpha", "delta"}) {
		t.Errorf("after writing an old tag = %v", got)
	}
}

// The chips on a row and the pills above it are the same tags, and two orders read as two sets.
func TestATasksTagsComeBackInTheCloudsOrder(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	made := c.task(`{"title":"One","tags":["alpha","beta","gamma"]}`)

	if resp := c.do("PUT", "/api/tags/order", `{"slugs":["gamma","beta","alpha"]}`); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("order = %s", resp.Status)
	}

	cloud := slugs(c.json(c.do("GET", "/api/tags", "")))
	got := taskTags(c.json(c.do("GET", "/api/tasks/"+made["id"].(string), "")))
	if !equal(got, cloud) {
		t.Errorf("row = %v, cloud = %v", got, cloud)
	}
	if !equal(got, []string{"gamma", "beta", "alpha"}) {
		t.Errorf("row = %v", got)
	}
}

// A rename is the same tag under another word, so it keeps the place the old word had.
func TestARenamedTagKeepsItsPlace(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"One","tags":["alpha","beta","gamma"]}`)

	if resp := c.do("PUT", "/api/tags/order", `{"slugs":["gamma","beta","alpha"]}`); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("order = %s", resp.Status)
	}
	if resp := c.do("PATCH", "/api/tags/beta", `{"slug":"zebra"}`); resp.StatusCode != http.StatusOK {
		t.Fatalf("rename = %s", resp.Status)
	}

	if got := slugs(c.json(c.do("GET", "/api/tags", ""))); !equal(got, []string{"gamma", "zebra", "alpha"}) {
		t.Errorf("after a rename = %v", got)
	}
}
