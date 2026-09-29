package store

import (
	"context"
	"fmt"
	"strings"
	"time"

	"taskio/internal/ids"
)

// Comment is one entry in a task's timeline: markdown like the description, and who wrote it.
//
// The account is always the task's own, so it is not stored; the token is, when one wrote it, by
// id and by the label it had then — a token revoked and forgotten since still names it.
type Comment struct {
	ID         string
	Body       string
	TokenID    string
	TokenLabel string
	CreatedAt  time.Time
}

// Comments lists a task's, oldest first, which is the order a timeline is read in.
func (s *Store) Comments(ctx context.Context, taskSeq int64) ([]*Comment, error) {
	rows, err := s.reader.QueryContext(ctx,
		`SELECT id, body, token_id, token_label, created_at FROM comments
		  WHERE task_seq = ? ORDER BY created_at, id`, taskSeq)
	if err != nil {
		return nil, fmt.Errorf("comments: %w", err)
	}
	defer rows.Close()
	out := []*Comment{}
	for rows.Next() {
		c := &Comment{}
		var at int64
		if err := rows.Scan(&c.ID, &c.Body, &c.TokenID, &c.TokenLabel, &at); err != nil {
			return nil, err
		}
		c.CreatedAt = time.Unix(at, 0).UTC()
		out = append(out, c)
	}
	return out, rows.Err()
}

// AddComment writes one onto a task, and pokes it: somebody writing about a task has looked at it.
//
// by is the token that wrote it, or nil for a session.
//
// The body goes the way a description does — inline images stored as assets, @prefixes turned
// into whole ids — and it is part of the task's text from then on: an image in it is referenced
// and kept, and a task it mentions is linked.
func (s *Store) AddComment(ctx context.Context, principalID string, reach Reach, taskID, body string, by *Token) (*Comment, error) {
	if strings.TrimSpace(body) == "" {
		return nil, Invalid("A comment needs something in it.")
	}
	// Before the transaction, like a task's edit: storing an image takes the one writer.
	body, err := s.inlineAssets(ctx, principalID, body)
	if err != nil {
		return nil, err
	}
	if len(body) > DescriptionMax {
		return nil, Invalid("That comment is larger than %d KB.", DescriptionMax>>10)
	}
	body = s.normalizeMentions(ctx, principalID, reach, body)

	now := s.Now()
	c := &Comment{
		ID:        ids.New(ids.Comment, now.UnixMilli()),
		Body:      body,
		CreatedAt: now,
	}
	if by != nil {
		c.TokenID, c.TokenLabel = by.ID, by.Label
	}

	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	task, err := loadTask(ctx, tx, principalID, taskID)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO comments (id, task_seq, token_id, token_label, body, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		c.ID, task.Seq, c.TokenID, c.TokenLabel, c.Body, unix(now)); err != nil {
		return nil, fmt.Errorf("add comment: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE tasks SET poked_at = ?, updated_at = ? WHERE seq = ?`,
		unix(now), unix(now), task.Seq); err != nil {
		return nil, fmt.Errorf("add comment: %w", err)
	}
	if err := syncContent(ctx, tx, task.Seq, principalID, reach, task.Title, task.Description); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("add comment: %w", err)
	}
	s.changed(principalID)
	return c, nil
}
