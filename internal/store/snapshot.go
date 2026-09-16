package store

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

// SnapshotTo writes a consistent copy of the database to path.
//
// VACUUM INTO rather than a file copy: a WAL database is three files with the committed state
// spread across them, so a file-level copy of a running instance is a copy of a moment that
// never existed.
func (s *Store) SnapshotTo(ctx context.Context, path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	// VACUUM INTO refuses to overwrite.
	os.Remove(path)
	if _, err := s.writer.ExecContext(ctx, `VACUUM INTO ?`, path); err != nil {
		return fmt.Errorf("snapshot: %w", err)
	}
	return nil
}
