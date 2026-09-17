package migrations

// Where a group sits in the rail.
//
// Zero for every group that existed before this, which leaves them in the order they were
// written — the tiebreak below position is still created_at, so nothing moves until somebody
// drags something.
var groupOrder = Migration{
	Name: "20260917060000_group_order",
	Up: exec(`
ALTER TABLE groups ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
DROP INDEX groups_principal;
CREATE INDEX groups_principal ON groups (principal_id, position, created_at, id);
`),
}
