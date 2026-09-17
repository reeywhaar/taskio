package migrations

// A group is a set of tags with a name: the filter somebody uses often enough to want it in
// the rail rather than typed again.
//
// Its own tables rather than a column on principals holding a list, because the thing being
// stored is a set per group and the rail reads them in a fixed order.
//
// A group may name a tag no task carries. That is not a dangling reference to be cleaned up —
// naming the group is often the moment somebody decides the tag exists, and a tag exists here
// only because something wrote it down.
var groups = Migration{
	Name: "20260917000000_groups",
	Up: exec(`
CREATE TABLE groups (
  id           TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
-- Oldest first, so adding one does not move the others in the rail.
CREATE INDEX groups_principal ON groups (principal_id, created_at, id);

CREATE TABLE group_tags (
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  slug     TEXT NOT NULL,
  PRIMARY KEY (group_id, slug)
) WITHOUT ROWID;
`),
}
