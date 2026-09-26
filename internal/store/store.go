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
	"sync"
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

	// watchers are told when content they can see moves, keyed by the account watching. A map
	// because the only operations are add, remove and walk, and a connection removes itself by
	// identity when its reader goes away.
	watchMu  sync.Mutex
	watchers map[chan struct{}]string
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

	s := &Store{
		writer:   writer,
		reader:   reader,
		now:      time.Now,
		watchers: map[chan struct{}]string{},
	}
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

// HoldWriter takes the one writer connection and keeps it until release, which is what a write
// stuck on it looks like from everywhere else. Tests prove with it that a read does not queue
// behind a write.
func (s *Store) HoldWriter(ctx context.Context) (release func(), err error) {
	conn, err := s.writer.Conn(ctx)
	if err != nil {
		return nil, err
	}
	return func() { conn.Close() }, nil
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

// changed records that one account's content moved. Callers bump it only on a write that
// changed something, which for an update means a non-zero RowsAffected from a statement
// carrying its own comparison.
func (s *Store) changed(principalID string) {
	s.changes.Add(1)
	s.notify(principalID)
}

// changedAll records a change that is nobody's in particular: the instance's settings, the
// roll of accounts, a sweep that reaches across all of them.
func (s *Store) changedAll() {
	s.changes.Add(1)
	s.notify("")
}

// Changes is the counter the backup loop compares against what the agent last accepted.
func (s *Store) Changes() uint64 { return s.changes.Load() }

/*
Watch is told when content this account can see moves, so a browser does not have to ask.

One buffered slot each and a send that gives up when it is full: a watcher that has not read
its last signal already knows there is something to fetch, and a hundred writes in a second are
one refetch. Dropping is the coalescing.

Nobody hears about anybody else's writing. What a watcher is sent carries nothing — not what
changed, only that something did — and the account it is scoped to is what keeps that from
being a fact about somebody else's afternoon.
*/
func (s *Store) Watch(principalID string) (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	s.watchMu.Lock()
	s.watchers[ch] = principalID
	s.watchMu.Unlock()

	return ch, func() {
		s.watchMu.Lock()
		delete(s.watchers, ch)
		s.watchMu.Unlock()
	}
}

// notify wakes the watchers of one account, or every watcher when principalID is empty.
func (s *Store) notify(principalID string) {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	for ch, watching := range s.watchers {
		if principalID != "" && watching != principalID {
			continue
		}
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

// unix is how every timestamp is stored: seconds in an INTEGER column.
func unix(t time.Time) int64 { return t.UTC().Unix() }
