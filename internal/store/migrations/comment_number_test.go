package migrations

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

// Comments written before numbers existed are numbered in the order they were written, within
// each task.
func TestOldCommentsAreNumberedInOrder(t *testing.T) {
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "t.db")+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	runUpTo(t, db, "20260929095725_comment_edited")

	for _, q := range []string{
		`INSERT INTO principals (id, username, password_hash, role, created_at) VALUES ('p_a', 'robin', 'x', 'admin', 1789000000)`,
		`INSERT INTO projects (id, principal_id, name, slug, is_default, position, created_at) VALUES ('pj_a', 'p_a', 'Main', 'main', 1, 0, 1)`,
		`INSERT INTO tasks (seq, id, principal_id, project_id, title, created_at, updated_at) VALUES (1, 'aaaaaaaa', 'p_a', 'pj_a', 'Fix the tap', 1, 1)`,
		`INSERT INTO tasks (seq, id, principal_id, project_id, title, created_at, updated_at) VALUES (2, 'bbbbbbbb', 'p_a', 'pj_a', 'Buy washers', 1, 1)`,
		// Out of order on purpose, and two at the same second, which the id breaks.
		`INSERT INTO comments (id, task_seq, body, created_at) VALUES ('c_3', 1, 'third', 30)`,
		`INSERT INTO comments (id, task_seq, body, created_at) VALUES ('c_1', 1, 'first', 10)`,
		`INSERT INTO comments (id, task_seq, body, created_at) VALUES ('c_2', 1, 'second', 10)`,
		`INSERT INTO comments (id, task_seq, body, created_at) VALUES ('c_4', 2, 'other', 20)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	if err := Run(context.Background(), db); err != nil {
		t.Fatal(err)
	}

	want := map[string]int{"c_1": 1, "c_2": 2, "c_3": 3, "c_4": 1}
	for id, n := range want {
		var got int
		if err := db.QueryRow(`SELECT n FROM comments WHERE id = ?`, id).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != n {
			t.Errorf("%s numbered %d, want %d", id, got, n)
		}
	}
}
