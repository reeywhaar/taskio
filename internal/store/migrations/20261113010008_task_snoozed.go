package migrations

// When a snoozed task comes back onto the list. NULL for one that was never snoozed.
var taskSnoozed = Migration{
	Name: "20261113010008_task_snoozed",
	Up:   exec(`ALTER TABLE tasks ADD COLUMN snoozed_until INTEGER;`),
}
