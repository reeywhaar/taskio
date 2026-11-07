package migrations

// When a comment was deleted. The row stays, its words gone, so its number is never handed to
// another: a mention of #5 must not come to mean a comment written after it.
var commentDeleted = Migration{
	Name: "20261107232006_comment_deleted",
	Up:   exec(`ALTER TABLE comments ADD COLUMN deleted_at INTEGER;`),
}
