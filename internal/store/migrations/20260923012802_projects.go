package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"taskio/internal/ids"
)

// Projects: a hard separation of an account's tasks, each with its own tags, arrangement and
// groups.
//
// Every account gets one project, the default, and everything it already has moves into it:
// its tasks, its groups, the order its tags were dragged into, and every token it has minted.
// Nothing an account could see before is somewhere else afterwards — it is all in the one
// project, which is where a request that names no project goes.
//
// Go rather than SQL for the one thing SQL cannot do here, which is mint an id.
var projects = Migration{
	Name: "20260923012802_projects",
	Up: func(ctx context.Context, tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `
CREATE TABLE projects (
  id           TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  is_default   INTEGER NOT NULL DEFAULT 0,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  -- A deleted project stays as a row, so a token that reached it can be told it was deleted
  -- rather than that it never existed.
  deleted_at   INTEGER
);
-- Unique among the live ones: a deleted project's slug is free for the next.
CREATE UNIQUE INDEX projects_slug ON projects (principal_id, slug) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX projects_default ON projects (principal_id) WHERE is_default = 1;
CREATE INDEX projects_principal ON projects (principal_id, position, created_at);
`); err != nil {
			return fmt.Errorf("projects table: %w", err)
		}

		// One default project per account, dated from the account: it has existed as long as
		// the tasks now in it have.
		rows, err := tx.QueryContext(ctx, `SELECT id, created_at FROM principals`)
		if err != nil {
			return err
		}
		type account struct {
			id      string
			created int64
		}
		var accounts []account
		for rows.Next() {
			var a account
			if err := rows.Scan(&a.id, &a.created); err != nil {
				rows.Close()
				return err
			}
			accounts = append(accounts, a)
		}
		rows.Close()
		for _, a := range accounts {
			id := ids.New(ids.Project, time.Unix(a.created, 0).UnixMilli())
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO projects (id, principal_id, name, slug, is_default, position, created_at)
				 VALUES (?, ?, 'Main', 'main', 1, 0, ?)`, id, a.id, a.created); err != nil {
				return fmt.Errorf("default project: %w", err)
			}
		}

		_, err = tx.ExecContext(ctx, `
-- Without a REFERENCES clause: SQLite will not add one with a default other than NULL while
-- foreign keys are on, and every row is backfilled on the next line anyway. Deleting a project
-- deletes its tasks and groups in code, which is where the confirmation is.
ALTER TABLE tasks ADD COLUMN project_id TEXT NOT NULL DEFAULT '';
UPDATE tasks SET project_id =
  (SELECT id FROM projects WHERE projects.principal_id = tasks.principal_id AND is_default = 1);
CREATE INDEX tasks_project_live ON tasks (project_id, pinned DESC, priority DESC, created_at DESC, seq DESC);
CREATE INDEX tasks_project_done ON tasks (project_id, done_at DESC, seq DESC);

ALTER TABLE groups ADD COLUMN project_id TEXT NOT NULL DEFAULT '';
UPDATE groups SET project_id =
  (SELECT id FROM projects WHERE projects.principal_id = groups.principal_id AND is_default = 1);
CREATE INDEX groups_project ON groups (project_id, position, created_at, id);

-- The arrangement belongs to a project now. Rebuilt rather than altered, because the key is
-- what changes, and SQLite cannot change a primary key in place.
CREATE TABLE tag_order_by_project (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  slug       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  PRIMARY KEY (project_id, slug)
) WITHOUT ROWID;
INSERT INTO tag_order_by_project (project_id, slug, position)
  SELECT projects.id, tag_order.slug, tag_order.position
    FROM tag_order JOIN projects ON projects.principal_id = tag_order.principal_id
                                AND projects.is_default = 1;
DROP TABLE tag_order;
ALTER TABLE tag_order_by_project RENAME TO tag_order;

-- A token reaches a set of projects, each with its own tags. The scope it had becomes its row
-- for the default project, which is where everything it could reach now is.
CREATE TABLE token_projects (
  token_id   TEXT NOT NULL REFERENCES tokens (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects (id),
  scope      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (token_id, project_id)
) WITHOUT ROWID;
INSERT INTO token_projects (token_id, project_id, scope)
  SELECT tokens.id, projects.id, tokens.scope
    FROM tokens JOIN projects ON projects.principal_id = tokens.principal_id
                             AND projects.is_default = 1;
ALTER TABLE tokens DROP COLUMN scope;
`)
		if err != nil {
			return fmt.Errorf("move into projects: %w", err)
		}
		return nil
	},
}
