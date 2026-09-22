package migrations

// Where a token was last used from, and how long it may sit unused.
//
// last_used_at was already kept. What it could not answer is the question somebody asks when a
// token looks wrong — used by what, from where — and a token nobody has used for a month is a
// credential still open on a machine nobody remembers.
var tokenSeen = Migration{
	Name: "20260922033902_token_seen",
	Up: exec(`
ALTER TABLE tokens ADD COLUMN last_ip TEXT NOT NULL DEFAULT '';
ALTER TABLE tokens ADD COLUMN last_agent TEXT NOT NULL DEFAULT '';
-- Seconds of disuse before it stops working. 0 is never, which is what every token has now.
ALTER TABLE tokens ADD COLUMN idle_ttl INTEGER NOT NULL DEFAULT 0;
`),
}
