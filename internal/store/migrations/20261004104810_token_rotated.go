package migrations

// When a token was last given a new secret. Null for one never rotated, which is every one so far.
//
// Rotation keeps the row, so the day it was minted stays put; the idle clock restarts from this.
var tokenRotated = Migration{
	Name: "20261004104810_token_rotated",
	Up:   exec(`ALTER TABLE tokens ADD COLUMN rotated_at INTEGER;`),
}
