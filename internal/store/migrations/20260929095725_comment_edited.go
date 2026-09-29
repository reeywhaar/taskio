package migrations

// When a comment was last edited. Null for one never edited, which is every one so far.
var commentEdited = Migration{
	Name: "20260929095725_comment_edited",
	Up:   exec(`ALTER TABLE comments ADD COLUMN edited_at INTEGER;`),
}
