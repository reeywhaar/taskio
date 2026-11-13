package api

import (
	"fmt"
	"net/http"
	"testing"
	"time"
)

// A snoozed task leaves the list for the snoozed one, soonest first, and comes back on its own
// when its moment does, as fresh as if just poked.
func TestASnoozedTaskComesBackOnItsOwn(t *testing.T) {
	s, st := newServerStore(t, nil)
	now := time.Date(2026, 11, 13, 9, 0, 0, 0, time.UTC)
	st.SetClock(func() time.Time { return now })
	c := signIn(t, s, st)

	c.task(`{"title":"Fix the tap"}`)
	week := c.task(fmt.Sprintf(`{"title":"Clean the gutters","snoozed_until":%d}`, now.Add(7*24*time.Hour).Unix()))
	day := c.task(`{"title":"Water the plants","snoozed_until":"2026-11-14"}`)

	if week["status"] != "snoozed" || day["snoozed_until"] != float64(time.Date(2026, 11, 14, 12, 0, 0, 0, time.UTC).Unix()) {
		t.Fatalf("snoozed as %v, %v", week["status"], day["snoozed_until"])
	}
	if got := c.order(""); len(got) != 1 || got[0] != "Fix the tap" {
		t.Errorf("todo = %v", got)
	}
	if got := c.order("?status=snoozed"); len(got) != 2 || got[0] != "Water the plants" {
		t.Errorf("snoozed = %v, want soonest first", got)
	}
	if got := c.order("?status=all"); len(got) != 3 {
		t.Errorf("all = %v", got)
	}

	// Its moment comes, and nobody does anything.
	now = time.Date(2026, 11, 14, 12, 0, 0, 0, time.UTC)
	if got := c.order(""); len(got) != 2 || got[0] != "Water the plants" {
		t.Errorf("todo = %v, want the woken one on top", got)
	}
	back := c.json(c.do("GET", "/api/tasks/"+day["id"].(string), ""))
	if back["status"] != "todo" || back["snoozed_until"] != nil || back["poked_at"] != float64(now.Unix()) {
		t.Errorf("woke as %v, until %v, poked %v", back["status"], back["snoozed_until"], back["poked_at"])
	}
}

// Zero wakes one now, and a moment already past is the same as zero.
func TestASnoozeCanBeCalledOff(t *testing.T) {
	s, st := newServerStore(t, nil)
	now := time.Date(2026, 11, 13, 9, 0, 0, 0, time.UTC)
	st.SetClock(func() time.Time { return now })
	c := signIn(t, s, st)

	task := c.task(`{"title":"Fix the tap","snoozed_until":"2026-12-01"}`)
	id := task["id"].(string)
	woke := c.json(c.do("PATCH", "/api/tasks/"+id, `{"snoozed_until":0}`))
	if woke["status"] != "todo" || woke["snoozed_until"] != nil {
		t.Errorf("woke as %v until %v", woke["status"], woke["snoozed_until"])
	}

	past := c.task(`{"title":"Order the part","snoozed_until":"2026-11-01"}`)
	if past["status"] != "todo" || past["snoozed_until"] != nil {
		t.Errorf("a snooze into the past left it %v until %v", past["status"], past["snoozed_until"])
	}
}

func TestASnoozeThatIsNotAMomentIsRefused(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	for _, v := range []string{`"next week"`, `"2026-13-01"`, `true`} {
		resp := c.do("POST", "/api/tasks", `{"title":"Fix the tap","snoozed_until":`+v+`}`)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s = %s", v, resp.Status)
		}
	}
}
