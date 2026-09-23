package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
)

// BulkTags is what a bulk tag change asks for. Remove is applied after Add, so a slug in both
// is removed — one rule, stated, rather than an order that emerges from the loop.
type BulkTags struct {
	Add    []string
	Remove []string
}

// BulkDone marks a set done or undone, in one transaction.
func (s *Store) BulkDone(ctx context.Context, principalID string, reach Reach, refs []string, done bool) error {
	return s.bulk(ctx, principalID, reach, refs, func(tx *sql.Tx, tasks []*Task) error {
		now := s.Now()
		var at any
		if done {
			at = unix(now)
		}
		for _, task := range tasks {
			seq := task.Seq
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
func (s *Store) BulkPriority(ctx context.Context, principalID string, reach Reach, refs []string, priority int) error {
	return s.bulk(ctx, principalID, reach, refs, func(tx *sql.Tx, tasks []*Task) error {
		now := s.Now()
		for _, task := range tasks {
			seq := task.Seq
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
func (s *Store) BulkPinned(ctx context.Context, principalID string, reach Reach, refs []string, pinned bool) error {
	return s.bulk(ctx, principalID, reach, refs, func(tx *sql.Tx, tasks []*Task) error {
		now := s.Now()
		for _, task := range tasks {
			seq := task.Seq
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
func (s *Store) BulkTagChange(ctx context.Context, principalID string, reach Reach, refs []string, change BulkTags) error {
	add, err := validTags(change.Add)
	if err != nil {
		return err
	}
	remove, err := validTags(change.Remove)
	if err != nil {
		return err
	}

	return s.bulk(ctx, principalID, reach, refs, func(tx *sql.Tx, tasks []*Task) error {
		// Asked of each task's result rather than of the slugs being removed: taking one of two
		// tags off is fine under a scope that needs either, and not under one that needs both.
		// Refused, never skipped — the whole call is one change, and it was not made.
		for _, task := range tasks {
			if err := reach.check(task.ProjectID, applyTags(task.Tags, add, remove)); err != nil {
				return err
			}
		}
		// Once per project rather than once per task: the arrangement is the project's.
		noted := map[string]bool{}
		for _, task := range tasks {
			if noted[task.ProjectID] {
				continue
			}
			noted[task.ProjectID] = true
			if err := noteTags(ctx, tx, task.ProjectID, add); err != nil {
				return err
			}
		}
		for _, task := range tasks {
			for _, slug := range add {
				if _, err := tx.ExecContext(ctx,
					`INSERT OR IGNORE INTO task_tags (task_seq, slug) VALUES (?, ?)`, task.Seq, slug); err != nil {
					return err
				}
			}
			for _, slug := range remove {
				if _, err := tx.ExecContext(ctx,
					`DELETE FROM task_tags WHERE task_seq = ? AND slug = ?`, task.Seq, slug); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

// applyTags is what a task carries after a bulk change: add first, then remove, so a slug in
// both is removed.
func applyTags(tags, add, remove []string) []string {
	out := []string{}
	for _, slug := range append(append([]string(nil), tags...), add...) {
		if !slices.Contains(remove, slug) && !slices.Contains(out, slug) {
			out = append(out, slug)
		}
	}
	return out
}

// BulkPoke says every task in the set still stands. See PokeTask.
func (s *Store) BulkPoke(ctx context.Context, principalID string, reach Reach, refs []string) error {
	return s.bulk(ctx, principalID, reach, refs, func(tx *sql.Tx, tasks []*Task) error {
		now := unix(s.Now())
		for _, task := range tasks {
			if _, err := tx.ExecContext(ctx,
				`UPDATE tasks SET poked_at = ?, updated_at = ? WHERE seq = ?`, now, now, task.Seq); err != nil {
				return err
			}
		}
		return nil
	})
}

// BulkMove puts every task in the set into one project, each with its tags. The project's rule
// applies to what each one carries, so a token moving tasks into a project it is confined in
// has to move tasks that already belong there by their tags.
func (s *Store) BulkMove(ctx context.Context, principalID string, reach Reach, refs []string, projectID string) error {
	return s.bulk(ctx, principalID, reach, refs, func(tx *sql.Tx, tasks []*Task) error {
		for _, task := range tasks {
			if err := reach.check(projectID, task.Tags); err != nil {
				return err
			}
		}
		now := unix(s.Now())
		for _, task := range tasks {
			if task.ProjectID == projectID {
				continue
			}
			if err := noteTags(ctx, tx, projectID, task.Tags); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx,
				`UPDATE tasks SET project_id = ?, updated_at = ? WHERE seq = ?`, projectID, now, task.Seq); err != nil {
				return err
			}
		}
		return nil
	})
}

// BulkDelete marks a set deleted. See DeleteTask: the mark, not a removal.
//
// The statement carries its own comparison, so a task already in the bin is not re-stamped —
// which would reset the ninety-day sweep on something that has been sitting there for weeks.
func (s *Store) BulkDelete(ctx context.Context, principalID string, reach Reach, refs []string) error {
	return s.bulk(ctx, principalID, reach, refs, func(tx *sql.Tx, tasks []*Task) error {
		now := unix(s.Now())
		for _, task := range tasks {
			seq := task.Seq
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
func (s *Store) bulk(ctx context.Context, principalID string, reach Reach, refs []string, apply func(*sql.Tx, []*Task) error) error {
	if len(refs) == 0 {
		return Invalid("That asked for nothing: give at least one task.")
	}
	if len(refs) > BulkMax {
		return Invalid("That is more than %d tasks in one call.", BulkMax)
	}

	tasks := make([]*Task, 0, len(refs))
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
		if !reach.Allows(task) {
			return NotFound("There is no task %s.", ref)
		}
		if !seen[task.Seq] {
			seen[task.Seq] = true
			tasks = append(tasks, task)
		}
	}

	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := apply(tx, tasks); err != nil {
		// A refusal from inside is already a sentence for the caller.
		if errors.Is(err, ErrTagsRequired) {
			return err
		}
		return fmt.Errorf("bulk: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.changed(principalID)
	return nil
}
