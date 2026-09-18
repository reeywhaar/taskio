package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"taskio/internal/filter"
)

// BulkTags is what a bulk tag change asks for. Remove is applied after Add, so a slug in both
// is removed — one rule, stated, rather than an order that emerges from the loop.
type BulkTags struct {
	Add    []string
	Remove []string
}

// BulkDone marks a set done or undone, in one transaction.
func (s *Store) BulkDone(ctx context.Context, principalID string, scope *filter.Node, refs []string, done bool) error {
	return s.bulk(ctx, principalID, scope, refs, func(tx *sql.Tx, seqs []int64) error {
		now := s.Now()
		var at any
		if done {
			at = unix(now)
		}
		for _, seq := range seqs {
			if _, err := tx.ExecContext(ctx,
				`UPDATE tasks SET done_at = ?, updated_at = ?
				  WHERE seq = ? AND ((done_at IS NULL) = ?)`,
				at, unix(now), seq, done); err != nil {
				return err
			}
		}
		return nil
	})
}

// BulkPriority sets one number across a set.
//
// The statement carries its own comparison, so a set already at that number is not a write: no
// updated_at moves, nothing is marked changed, and nobody's tab is woken for it.
func (s *Store) BulkPriority(ctx context.Context, principalID string, scope *filter.Node, refs []string, priority int) error {
	return s.bulk(ctx, principalID, scope, refs, func(tx *sql.Tx, seqs []int64) error {
		now := s.Now()
		for _, seq := range seqs {
			if _, err := tx.ExecContext(ctx,
				`UPDATE tasks SET priority = ?, updated_at = ?
				  WHERE seq = ? AND priority <> ?`,
				priority, unix(now), seq, priority); err != nil {
				return err
			}
		}
		return nil
	})
}

// BulkPinned pins or unpins a set.
func (s *Store) BulkPinned(ctx context.Context, principalID string, scope *filter.Node, refs []string, pinned bool) error {
	return s.bulk(ctx, principalID, scope, refs, func(tx *sql.Tx, seqs []int64) error {
		now := s.Now()
		for _, seq := range seqs {
			if _, err := tx.ExecContext(ctx,
				`UPDATE tasks SET pinned = ?, updated_at = ?
				  WHERE seq = ? AND pinned <> ?`,
				pinned, unix(now), seq, pinned); err != nil {
				return err
			}
		}
		return nil
	})
}

// BulkTagChange adds and removes tags across a set.
func (s *Store) BulkTagChange(ctx context.Context, principalID string, scope *filter.Node, refs []string, change BulkTags) error {
	add, err := validTags(change.Add)
	if err != nil {
		return err
	}
	remove, err := validTags(change.Remove)
	if err != nil {
		return err
	}
	// A scoped token's own tags cannot be removed, here as everywhere: a write may not take a
	// task out of the writer's reach.
	keep := map[string]bool{}
	for _, slug := range filter.Slugs(scope) {
		keep[slug] = true
	}

	return s.bulk(ctx, principalID, scope, refs, func(tx *sql.Tx, seqs []int64) error {
		// Once for the whole set rather than once per task: the arrangement is the account's.
		if err := noteTags(ctx, tx, principalID, add); err != nil {
			return err
		}
		for _, seq := range seqs {
			for _, slug := range add {
				if _, err := tx.ExecContext(ctx,
					`INSERT OR IGNORE INTO task_tags (task_seq, slug) VALUES (?, ?)`, seq, slug); err != nil {
					return err
				}
			}
			for _, slug := range remove {
				if keep[slug] {
					continue
				}
				if _, err := tx.ExecContext(ctx,
					`DELETE FROM task_tags WHERE task_seq = ? AND slug = ?`, seq, slug); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

// BulkDelete marks a set deleted. See DeleteTask: the mark, not a removal.
//
// The statement carries its own comparison, so a task already in the bin is not re-stamped —
// which would reset the thirty-day sweep on something that has been sitting there for weeks.
func (s *Store) BulkDelete(ctx context.Context, principalID string, scope *filter.Node, refs []string) error {
	return s.bulk(ctx, principalID, scope, refs, func(tx *sql.Tx, seqs []int64) error {
		now := unix(s.Now())
		for _, seq := range seqs {
			if _, err := tx.ExecContext(ctx,
				`UPDATE tasks
				    SET deleted_at = ?, done_at = COALESCE(done_at, ?), updated_at = ?
				  WHERE seq = ? AND deleted_at IS NULL`, now, now, now, seq); err != nil {
				return err
			}
		}
		return nil
	})
}

// bulk resolves every reference, then applies the change in one transaction.
//
// All or nothing: an unknown or unreachable id refuses the whole call naming the first one,
// rather than applying eleven of twelve changes and reporting a partial success the interface
// then has to reconcile.
func (s *Store) bulk(ctx context.Context, principalID string, scope *filter.Node, refs []string, apply func(*sql.Tx, []int64) error) error {
	if len(refs) == 0 {
		return Invalid("That asked for nothing: give at least one task.")
	}
	if len(refs) > BulkMax {
		return Invalid("That is more than %d tasks in one call.", BulkMax)
	}

	seqs := make([]int64, 0, len(refs))
	seen := map[int64]bool{}
	for _, ref := range refs {
		id, err := s.ResolveTask(ctx, principalID, ref)
		if err != nil {
			return err
		}
		task, err := loadTask(ctx, s.reader, principalID, id)
		if err != nil {
			return err
		}
		if !inScope(task, scope) {
			return NotFound("There is no task %s.", ref)
		}
		if !seen[task.Seq] {
			seen[task.Seq] = true
			seqs = append(seqs, task.Seq)
		}
	}

	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := apply(tx, seqs); err != nil {
		return fmt.Errorf("bulk: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.changed(principalID)
	return nil
}

// inScope reports whether a task carries every slug a scope names.
func inScope(task *Task, scope *filter.Node) bool {
	if scope == nil {
		return true
	}
	have := map[string]bool{}
	for _, slug := range task.Tags {
		have[slug] = true
	}
	for _, slug := range filter.Slugs(scope) {
		if !have[slug] {
			return false
		}
	}
	return true
}

var _ = strings.TrimSpace
