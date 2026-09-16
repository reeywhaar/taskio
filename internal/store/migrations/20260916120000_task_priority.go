package migrations

// Priority and pinning both order the live list above the clock.
//
// Two columns rather than one: a pin is a place somebody put a task and a priority is how much
// it matters, and collapsing them would mean unpinning a task by lowering its number.
//
// The index is replaced rather than added to. The live list reads pinned, then priority, then
// the clock, and an index on (principal_id, created_at, seq) cannot serve that order.
var taskPriority = Migration{
	Name: "20260916120000_task_priority",
	Up: exec(`
ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
DROP INDEX tasks_live;
CREATE INDEX tasks_live ON tasks (principal_id, pinned DESC, priority DESC, created_at DESC, seq DESC);
`),
}
