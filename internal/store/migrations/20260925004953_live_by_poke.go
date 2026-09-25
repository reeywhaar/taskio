package migrations

// The live list sorts by the last poke rather than by when a task was written, inside its pin
// and priority, so the index that walks it does too.
var liveByPoke = Migration{
	Name: "20260925004953_live_by_poke",
	Up: exec(`
DROP INDEX tasks_project_live;
CREATE INDEX tasks_project_live ON tasks (project_id, pinned DESC, priority DESC, poked_at DESC, seq DESC);
`),
}
