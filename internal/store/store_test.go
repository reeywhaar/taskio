package store

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// A temporary file, not :memory:. WAL behaves differently in memory and WAL is what is being
// relied on, including the two pools.
func openStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func TestOpenAppliesTheSchema(t *testing.T) {
	st := openStore(t)

	var version int
	if err := st.writer.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version == 0 {
		t.Fatal("nothing was applied")
	}

	for _, table := range []string{
		"principals", "invites", "sessions", "tasks", "task_tags",
		"assets", "asset_blobs", "task_assets", "task_mentions",
		"tokens", "user_recovery", "recovery_pending", "smtp", "limits",
	} {
		var n int
		if err := st.reader.QueryRow(
			"SELECT count(*) FROM sqlite_master WHERE type='table' AND name = ?", table).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Errorf("no table %q", table)
		}
	}
}

// A pragma in a DSN is a request. One silently ignored permits orphaned rows for the life of
// the connection, so both pools are read back.
func TestBothPoolsHaveTheirPragmas(t *testing.T) {
	st := openStore(t)
	for name, db := range map[string]*sql.DB{"writer": st.writer, "reader": st.reader} {
		var mode string
		if err := db.QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil {
			t.Fatal(err)
		}
		if mode != "wal" {
			t.Errorf("%s journal_mode = %q", name, mode)
		}
		var fk int
		if err := db.QueryRow("PRAGMA foreign_keys").Scan(&fk); err != nil {
			t.Fatal(err)
		}
		if fk != 1 {
			t.Errorf("%s has foreign_keys off", name)
		}
	}
}

// Running twice must be a no-op, or a restart re-applies the schema and fails.
func TestMigrationsAreIdempotent(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	st.Close()

	st, err = Open(dir)
	if err != nil {
		t.Fatalf("second open: %v", err)
	}
	st.Close()
}

// A binary that does not understand the schema in front of it cannot know which of its
// statements are still correct.
func TestAVersionAheadOfTheBuildRefusesToOpen(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.writer.Exec("PRAGMA user_version = 9999"); err != nil {
		t.Fatal(err)
	}
	st.Close()

	if _, err := Open(dir); err == nil {
		t.Fatal("opened a database written by a newer build")
	}
}

// The second pool exists so an asset read does not queue every write behind it.
func TestALongReadDoesNotBlockAWrite(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()

	if _, err := st.writer.ExecContext(ctx,
		`INSERT INTO principals (id, username, password_hash, role, created_at)
		 VALUES ('p_1', 'misha', 'x', 'admin', 1)`); err != nil {
		t.Fatal(err)
	}

	// Hold every reader open, then write.
	var wg sync.WaitGroup
	release := make(chan struct{})
	for i := 0; i < readers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			tx, err := st.reader.BeginTx(ctx, nil)
			if err != nil {
				return
			}
			tx.QueryRowContext(ctx, "SELECT count(*) FROM principals").Scan(new(int))
			<-release
			tx.Rollback()
		}()
	}

	done := make(chan error, 1)
	go func() {
		_, err := st.writer.ExecContext(ctx,
			`INSERT INTO principals (id, username, password_hash, role, created_at)
			 VALUES ('p_2', 'other', 'x', 'user', 2)`)
		done <- err
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("write failed while reads were open: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("a write queued behind open reads, which is what the second pool exists to prevent")
	}
	close(release)
	wg.Wait()
}

// ON DELETE CASCADE is load-bearing for the sweeps: deleting a task must take its joins.
func TestDeletingATaskTakesItsJoins(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	mustExec(t, st, `INSERT INTO principals (id, username, password_hash, role, created_at)
	                 VALUES ('p_1','misha','x','admin',1)`)
	mustExec(t, st, `INSERT INTO tasks (seq, id, principal_id, title, created_at, updated_at)
	                 VALUES (1,'8qw4tz9k','p_1','Fix the tap',1,1)`)
	mustExec(t, st, `INSERT INTO tasks (seq, id, principal_id, title, created_at, updated_at)
	                 VALUES (2,'kr20fj8m','p_1','Call the plumber',1,1)`)
	mustExec(t, st, `INSERT INTO task_tags (task_seq, slug) VALUES (1,'home')`)
	mustExec(t, st, `INSERT INTO task_mentions (from_seq, to_seq) VALUES (2,1)`)

	mustExec(t, st, `DELETE FROM tasks WHERE seq = 1`)

	var tags, mentions int
	st.reader.QueryRowContext(ctx, "SELECT count(*) FROM task_tags").Scan(&tags)
	st.reader.QueryRowContext(ctx, "SELECT count(*) FROM task_mentions").Scan(&mentions)
	if tags != 0 || mentions != 0 {
		t.Errorf("tags = %d, mentions = %d, want both collected", tags, mentions)
	}
}

// Case is not what makes two accounts different.
func TestUsernamesAreUniqueRegardlessOfCase(t *testing.T) {
	st := openStore(t)
	mustExec(t, st, `INSERT INTO principals (id, username, password_hash, role, created_at)
	                 VALUES ('p_1','Misha','x','admin',1)`)
	if _, err := st.writer.Exec(`INSERT INTO principals (id, username, password_hash, role, created_at)
	                             VALUES ('p_2','misha','x','user',2)`); err == nil {
		t.Fatal("registered the same username in two cases")
	}
}

func TestTheClockIsInjectable(t *testing.T) {
	st := openStore(t)
	at := time.Date(2026, 9, 16, 4, 0, 0, 0, time.UTC)
	st.SetClock(func() time.Time { return at })
	if !st.Now().Equal(at) {
		t.Errorf("now = %v, want %v", st.Now(), at)
	}
}

// The image declares no VOLUME, so a forgotten -v must be loud rather than a database
// written into the container layer and lost on the next replace.
func TestAMissingDataDirectoryRefusesToStart(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "not-mounted")
	_, err := Open(missing)
	if err == nil {
		t.Fatal("started without the data directory, and would have lost the database")
	}
	if !strings.Contains(err.Error(), missing) {
		t.Errorf("error does not name the directory: %v", err)
	}
	if _, statErr := os.Stat(missing); !os.IsNotExist(statErr) {
		t.Error("the directory was created; it must be mounted, not invented")
	}
}

func TestOpenRefusesAFileWhereTheDirectoryShouldBe(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data")
	if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(path); err == nil {
		t.Fatal("accepted a file as the data directory")
	}
}

func mustExec(t *testing.T, st *Store, q string) {
	t.Helper()
	if _, err := st.writer.Exec(q); err != nil {
		t.Fatal(err)
	}
}

// A stopped instance should leave a directory holding one whole database rather than three
// files that have to be copied together.
func TestCloseEmptiesTheWriteAheadLog(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	// Enough writing that the -wal is not empty by accident.
	p, err := st.CreatePrincipal(ctx, "misha", "a good password", RoleUser)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 50; i++ {
		if _, err := st.CreateTask(ctx, p.ID, nil, TaskNew{Title: "Fix the tap", Description: strings.Repeat("x", 4096)}); err != nil {
			t.Fatal(err)
		}
	}
	wal := filepath.Join(dir, FileName+"-wal")
	if info, err := os.Stat(wal); err != nil || info.Size() == 0 {
		t.Skip("this build does not leave a -wal to truncate")
	}

	if err := st.Close(); err != nil {
		t.Fatal(err)
	}

	if info, err := os.Stat(wal); err == nil && info.Size() > 0 {
		t.Errorf("the -wal is still %d bytes after a clean close", info.Size())
	}

	// And what was written is in the file that remains.
	reopened, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	page, err := reopened.ListTasks(ctx, p.ID, nil, TaskQuery{}, "")
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 50 {
		t.Errorf("reopened with %d tasks, want 50", page.Total)
	}
}

// A prefix that names two tasks is its own kind of refusal: the caller's next move is to send
// more characters, not to choose a different value, so it cannot be the same error as a name
// already taken.
func TestAPrefixNamingTwoTasksIsAmbiguousRatherThanAConflict(t *testing.T) {
	st := openStore(t)
	mustExec(t, st, `INSERT INTO principals (id, username, password_hash, role, created_at)
	                 VALUES ('p_1','misha','x','admin',1)`)
	// Ids are minted at random, so two that share a prefix are written here rather than waited
	// for: 32⁴ apart, the wait is the point of the test being flaky instead.
	for _, id := range []string{"abcd1111", "abcd2222", "wxyz0000"} {
		mustExec(t, st, `INSERT INTO tasks (id, principal_id, title, description, created_at, updated_at)
		                 VALUES ('`+id+`','p_1','A task','',1,1)`)
	}

	_, err := st.Task(t.Context(), "p_1", "abcd")
	if !errors.Is(err, ErrAmbiguous) {
		t.Fatalf("resolving an ambiguous prefix gave %v, want ErrAmbiguous", err)
	}
	if errors.Is(err, ErrNotFound) {
		t.Error("an ambiguous prefix reads as a missing task")
	}
	for _, want := range []string{"abcd1111", "abcd2222"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the refusal does not name %s: %q", want, err)
		}
	}

	// And one that names a single task still resolves.
	task, err := st.Task(t.Context(), "p_1", "wxyz")
	if err != nil || task.ID != "wxyz0000" {
		t.Errorf("an unambiguous prefix gave %v, %v", task, err)
	}
}
