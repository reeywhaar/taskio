package api

import (
	"fmt"
	"net/http"
	"testing"
)

// order reads the titles off a list, top first.
func (c *client) order(query string) []string {
	c.t.Helper()
	return titles(c.list(query))
}

func TestPriorityLiftsATaskUpTheList(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	c.task(`{"title":"Ordinary"}`)
	c.task(`{"title":"Urgent","priority":5}`)
	c.task(`{"title":"Later","priority":-3}`)

	// Newest first within a priority, which is what the clock did before and still does.
	if got := c.order(""); len(got) != 3 || got[0] != "Urgent" || got[2] != "Later" {
		t.Errorf("order = %v", got)
	}
}

func TestPriorityCanBeChangedAfterwards(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	id := c.task(`{"title":"Ordinary"}`)["id"].(string)
	c.task(`{"title":"Urgent","priority":5}`)
	if got := c.order("")[0]; got != "Urgent" {
		t.Fatalf("top = %q", got)
	}

	resp := c.do("PATCH", "/api/tasks/"+id, `{"priority":9}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch = %s", resp.Status)
	}
	if got := c.json(resp)["priority"]; got != float64(9) {
		t.Errorf("priority = %v", got)
	}
	if got := c.order("")[0]; got != "Ordinary" {
		t.Errorf("top after the change = %q", got)
	}
}

// A pin is where somebody put a task; a priority is how much it matters.
func TestAPinnedTaskSitsAboveAHigherPriorityOne(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	c.task(`{"title":"Shouting","priority":99}`)
	c.task(`{"title":"Pinned","pinned":true}`)

	if got := c.order("")[0]; got != "Pinned" {
		t.Errorf("top = %q, want the pinned one", got)
	}
}

// Pinning decides the band and priority decides the order inside it, so the pinned group is
// itself sorted rather than being a heap that happens to float.
func TestPriorityOrdersWithinThePinnedGroup(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	c.task(`{"title":"Pinned, middling","pinned":true,"priority":3}`)
	c.task(`{"title":"Pinned, urgent","pinned":true,"priority":9}`)
	c.task(`{"title":"Pinned, later","pinned":true,"priority":-5}`)
	c.task(`{"title":"Loud but unpinned","priority":99}`)

	want := []string{"Pinned, urgent", "Pinned, middling", "Pinned, later", "Loud but unpinned"}
	got := c.order("")
	if len(got) != len(want) {
		t.Fatalf("order = %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("order = %v, want %v", got, want)
		}
	}
}

// Pinning is a property, not a status: a pinned task is still a todo.
func TestAPinnedTaskIsStillOnTheTodoList(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	c.task(`{"title":"Pinned","pinned":true}`)
	c.task(`{"title":"Ordinary"}`)

	if got := c.order(""); len(got) != 2 {
		t.Errorf("todo = %v, want both", got)
	}
	if got := c.order("?pinned=true"); len(got) != 1 || got[0] != "Pinned" {
		t.Errorf("pinned = %v", got)
	}
	if got := c.order("?pinned=false"); len(got) != 1 || got[0] != "Ordinary" {
		t.Errorf("unpinned = %v", got)
	}
}

func TestPinningAndUnpinning(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.task(`{"title":"Fix the tap"}`)["id"].(string)

	if got := c.json(c.do("PATCH", "/api/tasks/"+id, `{"pinned":true}`))["pinned"]; got != true {
		t.Errorf("pinned = %v", got)
	}
	if got := len(c.order("?pinned=true")); got != 1 {
		t.Errorf("pinned list has %d", got)
	}
	if got := c.json(c.do("PATCH", "/api/tasks/"+id, `{"pinned":false}`))["pinned"]; got != false {
		t.Errorf("unpinned = %v", got)
	}
	if got := len(c.order("?pinned=true")); got != 0 {
		t.Errorf("pinned list still has %d", got)
	}
}

func TestPinnedIsRefusedWhenItIsNotABoolean(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	if resp := c.do("GET", "/api/tasks?pinned=sometimes", ""); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("pinned=sometimes = %s", resp.Status)
	}
}

// Pinning and priority are about what to do next, which a finished task no longer has an
// answer to — so the record of what happened stays in the order it happened.
func TestTheDoneListIgnoresPinsAndPriority(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	first := c.task(`{"title":"Finished first","priority":99,"pinned":true}`)["id"].(string)
	second := c.task(`{"title":"Finished second"}`)["id"].(string)
	c.do("POST", "/api/tasks/"+first+"/done", "")
	c.do("POST", "/api/tasks/"+second+"/done", "")

	if got := c.order("?status=done"); len(got) != 2 || got[0] != "Finished second" {
		t.Errorf("done order = %v, want the last one finished on top", got)
	}
}

// The cursor carries one value per sort column, so a page boundary inside a priority holds.
func TestPagingHoldsAcrossPriorities(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	for i := range 6 {
		c.task(fmt.Sprintf(`{"title":"Task %d","priority":%d}`, i, i%3))
	}

	seen := []string{}
	query := "?limit=2"
	for range 5 {
		page := c.list(query)
		seen = append(seen, titles(page)...)
		next, ok := page["next_cursor"].(string)
		if !ok {
			break
		}
		query = "?limit=2&cursor=" + next
	}

	if len(seen) != 6 {
		t.Fatalf("paged %d tasks, want 6: %v", len(seen), seen)
	}
	unique := map[string]bool{}
	for _, title := range seen {
		if unique[title] {
			t.Fatalf("%q came back twice: %v", title, seen)
		}
		unique[title] = true
	}
	if seen[0] != "Task 5" || seen[len(seen)-1] != "Task 0" {
		t.Errorf("paged order = %v", seen)
	}
}

// A pin leads everywhere, including a ranked list. Ranking by score alone put a pinned task
// below an unpinned one the moment somebody typed, which reads as the pin having stopped
// working rather than as the list having changed its question.
func TestSearchKeepsPinnedFirst(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	// The unpinned one is the better match: an exact title against a prefix of one.
	c.task(`{"title":"plumbing"}`)
	c.task(`{"title":"plumbing and other jobs","pinned":true}`)

	got := c.order("?q=plumbing")
	if len(got) != 2 || got[0] != "plumbing and other jobs" {
		t.Errorf("search order = %v, want the pinned one first", got)
	}
}
