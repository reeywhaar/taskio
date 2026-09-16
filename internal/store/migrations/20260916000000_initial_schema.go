package migrations

// The whole schema, including the columns nothing uses yet.
//
// A column added now is a line here; a column added later is a migration, a backfill and a
// release. What the first steps leave out is the interface for them, not the storage.
var initialSchema = Migration{
	Name: "20260916000000_initial_schema",
	Up: exec(`
CREATE TABLE principals (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  disabled_at   INTEGER
);
-- Rather than a lower() at every call site, so "Misha" and "misha" cannot both register.
CREATE UNIQUE INDEX principals_username ON principals (lower(username));

CREATE TABLE invites (
  id           TEXT PRIMARY KEY,
  token_hash   BLOB NOT NULL UNIQUE,
  created_by   TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  accepted_at  INTEGER,
  principal_id TEXT
);

CREATE TABLE sessions (
  id_hash      BLOB PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  user_agent   TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX sessions_principal ON sessions (principal_id, last_seen_at DESC);
CREATE INDEX sessions_expiry ON sessions (expires_at);

-- seq is the key and id is the name. seq is the rowid, so it is free, monotonic, and what
-- every join below references; id is the eight characters the outside world uses.
CREATE TABLE tasks (
  seq          INTEGER PRIMARY KEY,
  id           TEXT NOT NULL UNIQUE,
  principal_id TEXT NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  done_at      INTEGER
);
CREATE INDEX tasks_live ON tasks (principal_id, created_at DESC, seq DESC);
CREATE INDEX tasks_done ON tasks (principal_id, done_at DESC, seq DESC);
-- Serves the prefix range scan, which is a bounded id >= ? AND id < ? rather than a LIKE.
CREATE INDEX tasks_prefix ON tasks (principal_id, id);

-- A tag is a slug written on a task. There is no tags table: the set an account has is
-- whatever its tasks say it is.
CREATE TABLE task_tags (
  task_seq INTEGER NOT NULL REFERENCES tasks (seq) ON DELETE CASCADE,
  slug     TEXT NOT NULL,
  PRIMARY KEY (task_seq, slug)
) WITHOUT ROWID;
-- The filter asks in the other direction, one EXISTS per slug.
CREATE INDEX task_tags_slug ON task_tags (slug, task_seq);

CREATE TABLE assets (
  id           TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  sha256       BLOB NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
-- The same screenshot pasted into three tasks is one row. Per account, never global: sharing
-- a blob between accounts would make one person's delete reach another's task.
CREATE UNIQUE INDEX assets_content ON assets (principal_id, sha256);
CREATE INDEX assets_sweep ON assets (created_at);

-- Bytes in their own table, so nothing that lists or sums assets drags megabytes through the
-- driver. That is a property of the schema rather than of everyone remembering to name columns.
CREATE TABLE asset_blobs (
  asset_id TEXT PRIMARY KEY REFERENCES assets (id) ON DELETE CASCADE,
  bytes    BLOB NOT NULL
) WITHOUT ROWID;

CREATE TABLE task_assets (
  task_seq INTEGER NOT NULL REFERENCES tasks (seq) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  PRIMARY KEY (task_seq, asset_id)
) WITHOUT ROWID;
-- Answers "is anything still referencing this", which is the sweep's only question.
CREATE INDEX task_assets_asset ON task_assets (asset_id);

CREATE TABLE task_mentions (
  from_seq INTEGER NOT NULL REFERENCES tasks (seq) ON DELETE CASCADE,
  to_seq   INTEGER NOT NULL REFERENCES tasks (seq) ON DELETE CASCADE,
  PRIMARY KEY (from_seq, to_seq)
) WITHOUT ROWID;
-- Answers "what refers to this", which is the half a link alone cannot do.
CREATE INDEX task_mentions_to ON task_mentions (to_seq, from_seq);

CREATE TABLE tokens (
  id           TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  secret_hash  BLOB NOT NULL UNIQUE,
  hint         TEXT NOT NULL,
  scope        TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER,
  last_used_at INTEGER,
  revoked_at   INTEGER
);
CREATE INDEX tokens_principal ON tokens (principal_id, created_at DESC);

-- Two tables rather than a proved flag: a nullable flag is one forgotten WHERE clause away
-- from an unproved address being treated as proved.
CREATE TABLE user_recovery (
  principal_id TEXT PRIMARY KEY REFERENCES principals (id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  confirmed_at INTEGER NOT NULL
);
-- One address, one account, held by whoever proved it last.
CREATE UNIQUE INDEX user_recovery_email ON user_recovery (lower(email));

CREATE TABLE recovery_pending (
  principal_id TEXT PRIMARY KEY REFERENCES principals (id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  code_hash    BLOB NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE smtp (
  singleton    INTEGER PRIMARY KEY CHECK (singleton = 1),
  host         TEXT NOT NULL,
  port         INTEGER NOT NULL,
  security     TEXT NOT NULL,
  username     TEXT NOT NULL DEFAULT '',
  password     TEXT NOT NULL DEFAULT '',
  from_address TEXT NOT NULL,
  from_name    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE limits (
  singleton           INTEGER PRIMARY KEY CHECK (singleton = 1),
  asset_max_bytes     INTEGER NOT NULL,
  account_quota_bytes INTEGER NOT NULL
);
`),
}
