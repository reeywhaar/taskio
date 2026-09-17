package migrations

// Where somebody has dragged their tags.
//
// A row per slug rather than a list in a column: the cloud is redrawn from the tags in use, and
// a slug nothing carries any more is a row that simply never matches. It costs nothing to leave
// there, and it means dragging the tag back into use finds it where it was left.
//
// There is still no tags table. This is not one: it says where a tag goes if it exists, not
// that it does.
var tagOrder = Migration{
	Name: "20260917050000_tag_order",
	Up: exec(`
CREATE TABLE tag_order (
  principal_id TEXT NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  slug         TEXT NOT NULL,
  position     INTEGER NOT NULL,
  PRIMARY KEY (principal_id, slug)
) WITHOUT ROWID;
`),
}
