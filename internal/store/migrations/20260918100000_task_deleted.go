package migrations

// When a task was deleted, which is now a thing that happened to it rather than its absence.
//
// Deleting used to remove the row. That is the one operation in the program with nothing behind
// it: a mistyped id, a bulk selection off by one row, a confirmation dialog answered by reflex,
// and the task is gone along with its description, its tags and whatever it was mentioned by.
//
// So it is a mark, and the mark sits beside done_at rather than replacing it. A deleted task is
// finished with — it leaves the todo list, it appears at the top of the finished one where
// somebody can put it back, and the ninety-day sweep collects it on exactly the mechanics that
// already collect a done task. Null for everything that exists today, which is the truth about
// all of them.
var taskDeleted = Migration{
	Name: "20260918100000_task_deleted",
	Up:   exec(`ALTER TABLE tasks ADD COLUMN deleted_at INTEGER;`),
}
