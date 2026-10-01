package migrations

// A comment's number within its task, so it can be named as 8qw4tz9k#3. Counted from one in
// the order they were written; comments are never deleted, so a number never moves.
var commentNumber = Migration{
	Name: "20261001115623_comment_number",
	Up: exec(`
ALTER TABLE comments ADD COLUMN n INTEGER NOT NULL DEFAULT 0;
UPDATE comments SET n = (
  SELECT COUNT(*) FROM comments AS earlier
   WHERE earlier.task_seq = comments.task_seq
     AND (earlier.created_at < comments.created_at
          OR (earlier.created_at = comments.created_at AND earlier.id <= comments.id))
);
CREATE UNIQUE INDEX comments_number ON comments (task_seq, n);
`),
}
