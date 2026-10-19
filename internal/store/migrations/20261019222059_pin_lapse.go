package migrations

// When a task was pinned, and how long an account's pins hold, so a pin can lapse.
//
// The ones pinned now are stamped with the migration's own moment rather than left null or
// backdated: they get a full term from here, instead of every pin going at the first sweep.
var pinLapse = Migration{
	Name: "20261019222059_pin_lapse",
	Up: exec(`
ALTER TABLE tasks ADD COLUMN pinned_at INTEGER;
UPDATE tasks SET pinned_at = CAST(strftime('%s', 'now') AS INTEGER) WHERE pinned = 1;
-- Hours a pin holds, 0 for until it is taken off. A working day to begin with.
ALTER TABLE principals ADD COLUMN pin_hours INTEGER NOT NULL DEFAULT 8;
`),
}
