package store

import (
	"context"
	"testing"
	"time"
)

// The sweeps are tested for what they do not delete, which is the direction that matters.
func TestSweepsKeepWhatIsStillWanted(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	now := time.Date(2026, 9, 16, 4, 0, 0, 0, time.UTC)
	st.SetClock(func() time.Time { return now })

	p, err := st.CreatePrincipal(ctx, "misha", "a good password", RoleUser)
	if err != nil {
		t.Fatal(err)
	}

	recent, err := st.CreateTask(ctx, p.ID, nil, TaskNew{Title: "Done yesterday", Description: ""})
	if err != nil {
		t.Fatal(err)
	}
	old, err := st.CreateTask(ctx, p.ID, nil, TaskNew{Title: "Done long ago", Description: ""})
	if err != nil {
		t.Fatal(err)
	}
	open, err := st.CreateTask(ctx, p.ID, nil, TaskNew{Title: "Still open", Description: ""})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := st.SetDone(ctx, p.ID, old.ID, true); err != nil {
		t.Fatal(err)
	}
	now = now.Add(DoneRetention + time.Hour)
	if _, err := st.SetDone(ctx, p.ID, recent.ID, true); err != nil {
		t.Fatal(err)
	}

	n, err := st.SweepDoneTasks(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("swept %d tasks, want only the old one", n)
	}
	for _, id := range []string{recent.ID, open.ID} {
		if _, err := st.Task(ctx, p.ID, id); err != nil {
			t.Errorf("%s was swept and should not have been: %v", id, err)
		}
	}
	if _, err := st.Task(ctx, p.ID, old.ID); err == nil {
		t.Error("a task done thirty-one days ago survived")
	}
}

// A task done twenty-nine days ago survives, which is the edge the constant names.
func TestATaskJustInsideTheWindowSurvives(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	now := time.Date(2026, 9, 16, 4, 0, 0, 0, time.UTC)
	st.SetClock(func() time.Time { return now })

	p, _ := st.CreatePrincipal(ctx, "misha", "a good password", RoleUser)
	task, _ := st.CreateTask(ctx, p.ID, nil, TaskNew{Title: "Done recently", Description: ""})
	st.SetDone(ctx, p.ID, task.ID, true)

	now = now.Add(DoneRetention - time.Hour)
	if n, _ := st.SweepDoneTasks(ctx); n != 0 {
		t.Errorf("swept %d tasks one hour before the cutoff", n)
	}
}

// Marking a task todo again takes it out of the sweep's reach, which is what undo means here.
func TestReopeningATaskSavesItFromTheSweep(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	now := time.Date(2026, 9, 16, 4, 0, 0, 0, time.UTC)
	st.SetClock(func() time.Time { return now })

	p, _ := st.CreatePrincipal(ctx, "misha", "a good password", RoleUser)
	task, _ := st.CreateTask(ctx, p.ID, nil, TaskNew{Title: "Finished then not", Description: ""})
	st.SetDone(ctx, p.ID, task.ID, true)

	now = now.Add(DoneRetention + time.Hour)
	if _, err := st.SetDone(ctx, p.ID, task.ID, false); err != nil {
		t.Fatal(err)
	}
	if n, _ := st.SweepDoneTasks(ctx); n != 0 {
		t.Error("a reopened task was swept")
	}
}

func TestExpiredSessionsAreSweptAndLiveOnesAreNot(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	now := time.Date(2026, 9, 16, 4, 0, 0, 0, time.UTC)
	st.SetClock(func() time.Time { return now })

	p, _ := st.CreatePrincipal(ctx, "misha", "a good password", RoleUser)
	if _, err := st.CreateSession(ctx, "old-token", p.ID, "curl/8"); err != nil {
		t.Fatal(err)
	}
	now = now.Add(SessionLifetime + time.Hour)
	if _, err := st.CreateSession(ctx, "new-token", p.ID, "curl/8"); err != nil {
		t.Fatal(err)
	}

	n, err := st.SweepSessions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("swept %d sessions, want the lapsed one only", n)
	}
	if _, err := st.SessionByToken(ctx, "new-token"); err != nil {
		t.Error("the live session was swept")
	}
}

// A lapsed session is not a session that exists and is refused; it is not a session — and the
// listing filters the same way rather than waiting for the sweep.
func TestALapsedSessionIsNeitherUsableNorListed(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	now := time.Date(2026, 9, 16, 4, 0, 0, 0, time.UTC)
	st.SetClock(func() time.Time { return now })

	p, _ := st.CreatePrincipal(ctx, "misha", "a good password", RoleUser)
	st.CreateSession(ctx, "token", p.ID, "curl/8")

	now = now.Add(SessionLifetime + time.Minute)
	if _, err := st.SessionByToken(ctx, "token"); err == nil {
		t.Error("a lapsed session still authenticates")
	}
	list, err := st.Sessions(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Errorf("a lapsed session is still offered for revoking: %d rows", len(list))
	}
}

// --dry-run has to agree with what a real pass does, or it is worse than nothing.
func TestDryRunCountsWhatASweepWouldTake(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	now := time.Date(2026, 9, 16, 4, 0, 0, 0, time.UTC)
	st.SetClock(func() time.Time { return now })

	p, _ := st.CreatePrincipal(ctx, "misha", "a good password", RoleUser)
	for i := 0; i < 3; i++ {
		task, _ := st.CreateTask(ctx, p.ID, nil, TaskNew{Title: "Finished", Description: ""})
		st.SetDone(ctx, p.ID, task.ID, true)
	}
	st.CreateTask(ctx, p.ID, nil, TaskNew{Title: "Still open", Description: ""})
	now = now.Add(DoneRetention + time.Hour)

	counts, err := st.WouldSweep(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if counts.Tasks != 3 {
		t.Fatalf("dry run counted %d done tasks, want 3", counts.Tasks)
	}
	n, _ := st.SweepDoneTasks(ctx)
	if n != counts.Tasks {
		t.Errorf("dry run said %d and the sweep took %d", counts.Tasks, n)
	}
}

/**
 * A task thrown away is collected on the same thirty days as one that was finished, because it
 * carries done_at too. That is the whole reason deleting could stop removing the row: there is
 * already a mechanism that clears out what is over, and nothing had to be taught about a second
 * kind of over.
 */
func TestTheSweepCollectsADeletedTaskTheSameWay(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	now := time.Date(2026, 9, 18, 4, 0, 0, 0, time.UTC)
	st.SetClock(func() time.Time { return now })
	p, _ := st.CreatePrincipal(ctx, "misha", "a good password", RoleUser)

	binned, err := st.CreateTask(ctx, p.ID, nil, TaskNew{Title: "Thrown away long ago"})
	if err != nil {
		t.Fatal(err)
	}
	fresh, err := st.CreateTask(ctx, p.ID, nil, TaskNew{Title: "Thrown away just now"})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.DeleteTask(ctx, p.ID, binned.ID); err != nil {
		t.Fatal(err)
	}

	now = now.Add(DoneRetention + time.Hour)
	if err := st.DeleteTask(ctx, p.ID, fresh.ID); err != nil {
		t.Fatal(err)
	}

	n, err := st.SweepDoneTasks(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("swept %d, want only the one that had been in the bin a month", n)
	}
	if _, err := st.Task(ctx, p.ID, binned.ID); err == nil {
		t.Error("the month-old one is still there")
	}
	if _, err := st.Task(ctx, p.ID, fresh.ID); err != nil {
		t.Errorf("the one thrown away just now went with it: %v", err)
	}
}
