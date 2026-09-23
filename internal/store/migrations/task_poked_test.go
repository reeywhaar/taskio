package migrations

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

// A task written before pokes existed counts from when it was written, not from nothing.
func TestAnOldTaskCountsFromWhenItWasWritten(t *testing.T) {
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "t.db")+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	runUpTo(t, db, "20260923230409_task_poked")

	for _, q := range []string{
		`INSERT INTO principals (id, username, password_hash, role, created_at) VALUES ('p_a', 'robin', 'x', 'admin', 1789000000)`,
		`INSERT INTO projects (id, principal_id, name, slug, is_default, position, created_at) VALUES ('pj_a', 'p_a', 'Main', 'main', 1, 0, 1)`,
		`INSERT INTO tasks (seq, id, principal_id, project_id, title, created_at, updated_at) VALUES (1, 'aaaaaaaa', 'p_a', 'pj_a', 'Fix the tap', 1789100000, 1789200000)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	if err := Run(context.Background(), db); err != nil {
		t.Fatal(err)
	}

	var poked int64
	if err := db.QueryRow(`SELECT poked_at FROM tasks WHERE seq = 1`).Scan(&poked); err != nil {
		t.Fatal(err)
	}
	if poked != 1789100000 {
		t.Errorf("poked_at = %d, want the task's created_at", poked)
	}
}
