package migrations

// Where a session was last used from: the question a session raises when it looks wrong, as a
// token's last_ip already answers it. Empty until the session's next request.
var sessionIP = Migration{
	Name: "20261128095428_session_ip",
	Up:   exec(`ALTER TABLE sessions ADD COLUMN last_ip TEXT NOT NULL DEFAULT '';`),
}
