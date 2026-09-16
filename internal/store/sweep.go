package store

import (
	"context"
	"fmt"
	"time"
)

// How long things are kept.
const (
	// DoneRetention is how long a finished task stays before it is deleted outright. The only
	// delete in the program nobody asked for.
	DoneRetention = 30 * 24 * time.Hour

	// AssetGrace is how long an unreferenced asset is left alone.
	//
	// An asset with no references may have been uploaded ninety seconds ago into a description
	// nobody has saved yet, which is the normal path: the upload happens on paste and the save
	// happens when somebody finishes typing.
	AssetGrace = 24 * time.Hour
)

// SweepDoneTasks deletes what was finished long enough ago.
//
// Their tags, assets and mentions go by cascade, which is what leaves the orphans for the next
// pass to collect.
func (s *Store) SweepDoneTasks(ctx context.Context) (int64, error) {
	cutoff := s.Now().Add(-DoneRetention)
	res, err := s.writer.ExecContext(ctx,
		`DELETE FROM tasks WHERE done_at IS NOT NULL AND done_at <= ?`, unix(cutoff))
	if err != nil {
		return 0, fmt.Errorf("sweep done: %w", err)
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		s.changed()
	}
	return n, nil
}

// SweepOrphanAssets deletes blobs nothing references.
//
// The grace period is on created_at rather than on when the asset became unreferenced: the
// second would need a column written every time any description changes. One consequence is
// deliberate — an asset that loses its last reference is swept on the next pass, because its
// created_at is already old.
func (s *Store) SweepOrphanAssets(ctx context.Context) (int64, error) {
	cutoff := s.Now().Add(-AssetGrace)
	res, err := s.writer.ExecContext(ctx,
		`DELETE FROM assets
		  WHERE created_at <= ?
		    AND NOT EXISTS (SELECT 1 FROM task_assets WHERE task_assets.asset_id = assets.id)`,
		unix(cutoff))
	if err != nil {
		return 0, fmt.Errorf("sweep assets: %w", err)
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		s.changed()
	}
	return n, nil
}

// SweepRecovery drops attempts nobody finished.
func (s *Store) SweepRecovery(ctx context.Context) (int64, error) {
	res, err := s.writer.ExecContext(ctx,
		`DELETE FROM recovery_pending WHERE expires_at <= ?`, unix(s.Now()))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// Counts is what --dry-run reports: what would go, without anything going.
type Counts struct {
	Sessions int64
	Invites  int64
	Tasks    int64
	Assets   int64
	Bytes    int64
}

// WouldSweep counts what a pass would delete.
//
// Being able to look before it runs, on real data, is worth more than any test: orphan
// detection reads a join table rebuilt from parsed descriptions, and its failure mode is
// silently deleting an image somebody is using.
func (s *Store) WouldSweep(ctx context.Context) (Counts, error) {
	now := s.Now()
	var c Counts
	q := func(dest *int64, query string, args ...any) error {
		return s.reader.QueryRowContext(ctx, query, args...).Scan(dest)
	}
	if err := q(&c.Sessions, `SELECT count(*) FROM sessions WHERE expires_at <= ?`, unix(now)); err != nil {
		return c, err
	}
	if err := q(&c.Invites,
		`SELECT count(*) FROM invites WHERE accepted_at IS NULL AND expires_at <= ?`, unix(now)); err != nil {
		return c, err
	}
	if err := q(&c.Tasks,
		`SELECT count(*) FROM tasks WHERE done_at IS NOT NULL AND done_at <= ?`,
		unix(now.Add(-DoneRetention))); err != nil {
		return c, err
	}
	if err := q(&c.Assets,
		`SELECT count(*) FROM assets WHERE created_at <= ?
		   AND NOT EXISTS (SELECT 1 FROM task_assets WHERE task_assets.asset_id = assets.id)`,
		unix(now.Add(-AssetGrace))); err != nil {
		return c, err
	}
	if err := q(&c.Bytes,
		`SELECT coalesce(sum(size), 0) FROM assets WHERE created_at <= ?
		   AND NOT EXISTS (SELECT 1 FROM task_assets WHERE task_assets.asset_id = assets.id)`,
		unix(now.Add(-AssetGrace))); err != nil {
		return c, err
	}
	return c, nil
}
