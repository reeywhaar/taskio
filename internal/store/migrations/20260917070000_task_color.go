package migrations

// A color on a task, which means whatever the person who put it there decided it means.
//
// Empty is no color rather than a default one: the row draws its edge in the color or in
// nothing, and there is no third state to explain.
var taskColor = Migration{
	Name: "20260917070000_task_color",
	Up: exec(`
ALTER TABLE tasks ADD COLUMN color TEXT NOT NULL DEFAULT '';
`),
}
