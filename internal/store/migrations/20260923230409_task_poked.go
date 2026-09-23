package migrations

// When somebody last said a task still stands, by poking it.
//
// updated_at moves on any write — a tag taken off in bulk, a move between projects — and so
// cannot say how stale a task is. This moves only when somebody asks it to. A task nobody has
// poked counts from when it was written.
var taskPoked = Migration{
	Name: "20260923230409_task_poked",
	Up: exec(`
ALTER TABLE tasks ADD COLUMN poked_at INTEGER NOT NULL DEFAULT 0;
UPDATE tasks SET poked_at = created_at;
`),
}
