package migrations

// Agent access: a link that shows a token for five minutes, and the token it shows, which works
// for thirty. Neither is content, so making them, opening them and sweeping them away are not
// changes a backup is sent for.
//
// The link keeps its token sealed with a key only the link's own code gives, and the code is
// stored only as a hash: a copy of this table, in a backup or anywhere else, opens nothing.
var accessLinks = Migration{
	Name: "20261122194047_access_links",
	Up: exec(`
ALTER TABLE tokens ADD COLUMN temporary INTEGER NOT NULL DEFAULT 0;

CREATE TABLE access_links (
  id           TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  token_id     TEXT NOT NULL REFERENCES tokens (id) ON DELETE CASCADE,
  project_id   TEXT NOT NULL REFERENCES projects (id),
  group_id     TEXT,
  sealed       BLOB NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
`),
}
