package migrations

// Comments on a task: markdown like its description, in the order they were written, each saying
// who wrote it — the account, and the token when one was used, by its label at the time so a
// token revoked and forgotten since still names it.
var comments = Migration{
	Name: "20260929093922_comments",
	Up: exec(`
CREATE TABLE comments (
  id          TEXT PRIMARY KEY,
  task_seq    INTEGER NOT NULL REFERENCES tasks (seq) ON DELETE CASCADE,
  token_id    TEXT NOT NULL DEFAULT '',
  token_label TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX comments_task ON comments (task_seq, created_at, id);
`),
}
