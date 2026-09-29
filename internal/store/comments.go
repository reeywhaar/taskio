package store

import (
	"context"
	"database/sql"
	"errors"
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
	EditedAt   *time.Time
}

// Comments lists a task's, oldest first, which is the order a timeline is read in.
func (s *Store) Comments(ctx context.Context, taskSeq int64) ([]*Comment, error) {
	rows, err := s.reader.QueryContext(ctx,
		`SELECT id, body, token_id, token_label, created_at, edited_at FROM comments
		  WHERE task_seq = ? ORDER BY created_at, id`, taskSeq)
	if err != nil {
		return nil, fmt.Errorf("comments: %w", err)
	}
	defer rows.Close()
	out := []*Comment{}
	for rows.Next() {
		c, err := scanComment(rows)
		if err != nil {
			return nil, err
		}
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
	body, err := s.commentBody(ctx, principalID, reach, body)
	if err != nil {
		return nil, err
	}

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

// EditComment replaces a comment's words, and says it was edited.
//
// A token edits only what it wrote, so a timeline's attributions stay true of their words; the
// account, from a session, edits any. Not a poke: correcting a word is not saying the task stands.
func (s *Store) EditComment(ctx context.Context, principalID string, reach Reach, taskID, commentID, body string, by *Token) (*Comment, error) {
	body, err := s.commentBody(ctx, principalID, reach, body)
	if err != nil {
		return nil, err
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
	c, err := scanComment(tx.QueryRowContext(ctx,
		`SELECT id, body, token_id, token_label, created_at, edited_at FROM comments
		  WHERE id = ? AND task_seq = ?`, commentID, task.Seq))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, NotFound("There is no comment %s on that task.", commentID)
	}
	if err != nil {
		return nil, fmt.Errorf("edit comment: %w", err)
	}
	if by != nil && c.TokenID != by.ID {
		return nil, NotYours("That comment was not written by this token, and a token edits only its own.")
	}

	now := s.Now()
	c.Body, c.EditedAt = body, &now
	if _, err := tx.ExecContext(ctx,
		`UPDATE comments SET body = ?, edited_at = ? WHERE id = ?`,
		c.Body, unix(now), c.ID); err != nil {
		return nil, fmt.Errorf("edit comment: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE tasks SET updated_at = ? WHERE seq = ?`, unix(now), task.Seq); err != nil {
		return nil, fmt.Errorf("edit comment: %w", err)
	}
	if err := syncContent(ctx, tx, task.Seq, principalID, reach, task.Title, task.Description); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("edit comment: %w", err)
	}
	s.changed(principalID)
	return c, nil
}

// commentBody readies words for a comment the way a description's are readied: inline images
// stored as assets, @prefixes turned into whole ids.
//
// Before the transaction, like a task's edit: storing an image takes the one writer.
func (s *Store) commentBody(ctx context.Context, principalID string, reach Reach, body string) (string, error) {
	if strings.TrimSpace(body) == "" {
		return "", Invalid("A comment needs something in it.")
	}
	body, err := s.inlineAssets(ctx, principalID, body)
	if err != nil {
		return "", err
	}
	if len(body) > DescriptionMax {
		return "", Invalid("That comment is larger than %d KB.", DescriptionMax>>10)
	}
	return s.normalizeMentions(ctx, principalID, reach, body), nil
}

func scanComment(row interface{ Scan(...any) error }) (*Comment, error) {
	c := &Comment{}
	var at int64
	var edited sql.NullInt64
	if err := row.Scan(&c.ID, &c.Body, &c.TokenID, &c.TokenLabel, &at, &edited); err != nil {
		return nil, err
	}
	c.CreatedAt = time.Unix(at, 0).UTC()
	if edited.Valid {
		t := time.Unix(edited.Int64, 0).UTC()
		c.EditedAt = &t
	}
	return c, nil
}
