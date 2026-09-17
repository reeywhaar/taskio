package migrations

// A group can carry a color, which the tab wears.
//
// Empty means the brand color, so a group written before this one existed is not a group with
// a broken color — it is a group that has not been given one.
var groupColor = Migration{
	Name: "20260917040000_group_color",
	Up: exec(`
ALTER TABLE groups ADD COLUMN color TEXT NOT NULL DEFAULT '';
`),
}
