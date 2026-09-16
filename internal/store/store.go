// Package store is the database: one file, every query, and the migrations that shape it.
//
// It is the only package that writes SQL. Handlers do not build queries and nothing reaches
// past it into the file.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"

	_ "modernc.org/sqlite"

	"taskio/internal/store/migrations"
)

// FileName is the one database. Assets live in it too, which is what makes an archive the
// whole instance and a restore one file.
const FileName = "taskio.db"

// Store holds two pools over the same file.
//
// Every other service here uses a single connection and is right to. taskio serves image
// blobs out of the file it writes tasks into, and a 10MB read on one connection queues every
// write behind it. WAL readers do not block writers, so a second pool removes that for
// nothing.
type Store struct {
	// writer is capped at one. SQLite permits one writer regardless, and holding that at the
	// pool rather than discovering it as SQLITE_BUSY is the difference between a queue and a
	// retry loop.
	writer *sql.DB
	reader *sql.DB

	// now is injectable so expiry is driven rather than slept through.
	now func() time.Time

	// changes counts writes that changed content, which is what the backup loop watches.
	// Session touches and last-used stamps are the process noticing itself, not somebody
	// writing something down, so they do not bump it.
	changes atomic.Uint64
}

const readers = 4

// Open opens the database in dir, applies migrations, and verifies its pragmas.
//
// dir must already exist and is never created — see docs/deploy.md.
func Open(dir string) (*Store, error) {
	info, err := os.Stat(dir)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return nil, fmt.Errorf("%s does not exist: mount it, e.g. docker run -v taskio-data:%s", dir, dir)
	case err != nil:
		return nil, fmt.Errorf("%s: %w", dir, err)
	case !info.IsDir():
		return nil, fmt.Errorf("%s is not a directory", dir)
	}

	path := filepath.Join(dir, FileName)

	writer, err := open(path, 1)
	if err != nil {
		return nil, err
	}
	reader, err := open(path, readers)
	if err != nil {
		writer.Close()
		return nil, err
	}

	s := &Store{writer: writer, reader: reader, now: time.Now}
	if err := migrations.Run(context.Background(), writer); err != nil {
		s.Close()
		return nil, err
	}
	return s, nil
}

// open returns one pool with the pragmas set and checked.
func open(path string, maxOpen int) (*sql.DB, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	db.SetMaxOpenConns(maxOpen)

	for _, p := range []string{
		"journal_mode = WAL",
		"synchronous = NORMAL",
		"foreign_keys = ON",
		// Without this a single large asset write leaves a permanently huge -wal beside a
		// database that is mostly idle.
		"journal_size_limit = 67108864",
	} {
		if _, err := db.Exec("PRAGMA " + p); err != nil {
			db.Close()
			return nil, fmt.Errorf("pragma %s: %w", p, err)
		}
	}

	// A pragma is a request, not a guarantee. A foreign_keys that was silently ignored
	// permits orphaned rows for the life of the connection, so every one is read back.
	if err := verify(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func verify(db *sql.DB) error {
	var mode string
	if err := db.QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil {
		return err
	}
	if mode != "wal" {
		return fmt.Errorf("journal_mode is %q, not wal", mode)
	}
	var fk int
	if err := db.QueryRow("PRAGMA foreign_keys").Scan(&fk); err != nil {
		return err
	}
	if fk != 1 {
		return fmt.Errorf("foreign_keys is off")
	}
	return nil
}

// SetClock replaces the clock. Tests drive expiry with it.
func (s *Store) SetClock(now func() time.Time) { s.now = now }

// Now is the store's clock, in UTC.
func (s *Store) Now() time.Time { return s.now().UTC() }

// Close checkpoints the WAL and closes both pools.
//
// Order matters, and it is the one place the second pool costs something. SQLite checkpoints on
// its own when the last connection goes; with a reader pool still open the writer is not the
// last, so the readers are closed first and the checkpoint is asked for explicitly.
//
// TRUNCATE rather than the default passive one: it empties the -wal instead of leaving it at
// whatever size the largest write grew it to, so a stopped instance leaves a directory holding
// one whole database rather than three files that have to be copied together.
func (s *Store) Close() error {
	var first error
	keep := func(err error) {
		if err != nil && first == nil {
			first = err
		}
	}

	if s.reader != nil {
		keep(s.reader.Close())
	}
	if s.writer != nil {
		// Best effort: a checkpoint that cannot complete is not a reason to fail a shutdown,
		// and the data is committed either way.
		if _, err := s.writer.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
			keep(fmt.Errorf("checkpoint: %w", err))
		}
		keep(s.writer.Close())
	}
	return first
}

// changed records that content moved. Callers bump it only on a write that changed something,
// which for an update means a non-zero RowsAffected from a statement carrying its own
// comparison.
func (s *Store) changed() { s.changes.Add(1) }

// Changes is the counter the backup loop compares against what the agent last accepted.
func (s *Store) Changes() uint64 { return s.changes.Load() }

// unix is how every timestamp is stored: seconds in an INTEGER column.
func unix(t time.Time) int64 { return t.UTC().Unix() }
