package migrations

import (
	"context"
	"database/sql"
	"path/filepath"
	"sort"
	"testing"

	_ "modernc.org/sqlite"
)

// runUpTo applies the migrations before the named one, and stops there.
func runUpTo(t *testing.T, db *sql.DB, name string) {
	t.Helper()
	list := append([]Migration(nil), all...)
	sort.Slice(list, func(i, j int) bool { return list[i].Name < list[j].Name })
	ctx := context.Background()
	for i, m := range list {
		if m.Name == name {
			return
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := m.Up(ctx, tx); err != nil {
			t.Fatalf("%s: %v", m.Name, err)
		}
		if _, err := tx.Exec("PRAGMA user_version = " + itoa(i+1)); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	t.Fatalf("no migration %s", name)
}

func itoa(n int) string {
	if n < 10 {
		return string(rune('0' + n))
	}
	return itoa(n/10) + string(rune('0'+n%10))
}

// The one migration that moves data a live account already has, so it is run against some:
// everything an account could see before is in its default project afterwards, arranged the
// way it was, and a scoped token reaches exactly what it reached.
func TestEverythingMovesIntoTheDefaultProject(t *testing.T) {
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "t.db")+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	runUpTo(t, db, "20260923012802_projects")

	for _, q := range []string{
		`INSERT INTO principals (id, username, password_hash, role, created_at) VALUES ('p_a', 'misha', 'x', 'admin', 1789000000)`,
		`INSERT INTO tasks (seq, id, principal_id, title, created_at, updated_at) VALUES (1, 'aaaaaaaa', 'p_a', 'Fix the tap', 1, 1)`,
		`INSERT INTO task_tags (task_seq, slug) VALUES (1, 'home'), (1, 'work')`,
		`INSERT INTO tag_order (principal_id, slug, position) VALUES ('p_a', 'work', 0), ('p_a', 'home', 1)`,
		`INSERT INTO groups (id, principal_id, name, created_at) VALUES ('gr_a', 'p_a', 'Chores', 1)`,
		`INSERT INTO group_tags (group_id, slug) VALUES ('gr_a', 'home')`,
		`INSERT INTO tokens (id, principal_id, label, secret_hash, hint, scope, created_at) VALUES ('k_a', 'p_a', 'claude', x'00', 'h', 'and(work)', 1)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}

	if err := Run(context.Background(), db); err != nil {
		t.Fatal(err)
	}

	var project, name, slug string
	var isDefault int
	if err := db.QueryRow(`SELECT id, name, slug, is_default FROM projects WHERE principal_id = 'p_a'`).
		Scan(&project, &name, &slug, &isDefault); err != nil {
		t.Fatal(err)
	}
	if name != "Main" || slug != "main" || isDefault != 1 {
		t.Errorf("default project = %q %q default=%d", name, slug, isDefault)
	}

	var n int
	db.QueryRow(`SELECT count(*) FROM tasks WHERE project_id = ?`, project).Scan(&n)
	if n != 1 {
		t.Errorf("tasks in the default project = %d, want 1", n)
	}
	db.QueryRow(`SELECT count(*) FROM groups WHERE project_id = ?`, project).Scan(&n)
	if n != 1 {
		t.Errorf("groups in the default project = %d, want 1", n)
	}

	// Arranged as it was.
	rows, err := db.Query(`SELECT slug FROM tag_order WHERE project_id = ? ORDER BY position`, project)
	if err != nil {
		t.Fatal(err)
	}
	var order []string
	for rows.Next() {
		var s string
		rows.Scan(&s)
		order = append(order, s)
	}
	rows.Close()
	if len(order) != 2 || order[0] != "work" || order[1] != "home" {
		t.Errorf("tag order = %v, want work then home", order)
	}

	// A token reaches what it reached, as its row for the default project.
	var scope string
	if err := db.QueryRow(`SELECT scope FROM token_projects WHERE token_id = 'k_a' AND project_id = ?`, project).
		Scan(&scope); err != nil {
		t.Fatalf("the token's row: %v", err)
	}
	if scope != "and(work)" {
		t.Errorf("scope = %q, want and(work)", scope)
	}
	if _, err := db.Exec(`SELECT scope FROM tokens`); err == nil {
		t.Error("tokens still has a scope column beside the rows")
	}
}
