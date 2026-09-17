package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"taskio/internal/filter"
	"taskio/internal/ids"
)

// Tag is a slug and the id derived from it.
//
// There is no tags table: the set an account has is whatever its tasks say it is, so a tag is
// a slug written on a task and this struct is a rendering rather than a row.
type Tag struct {
	ID   string
	Slug string
}

// TagOf names a slug without printing the word, which is what a log line wants.
//
// A courtesy and not a protection: a slug is a short string from a small vocabulary, so anybody
// with a wordlist recovers it. It keeps the word out of plain sight.
func TagOf(slug string) Tag {
	return Tag{ID: ids.Derive(ids.Tag, []byte(slug)), Slug: slug}
}

// NormalizeSlug folds what somebody typed into a tag.
//
// Uppercase and spaces are folded rather than refused: somebody typing "Home Repairs" into the
// new-tag field means home-repairs, and refusing them would be correcting a person who was not
// wrong.
func NormalizeSlug(raw string) string {
	raw = strings.TrimSpace(strings.ToLower(raw))
	var b strings.Builder
	for _, r := range raw {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_', r == '-':
			b.WriteRune(r)
		case r == ' ' || r == '\t':
			b.WriteByte('-')
		}
	}
	return strings.Trim(b.String(), "-")
}

// Tags lists what an account's tasks actually carry.
//
// scope narrows it to a token's slice, on the same reasoning as the task list: whether a word
// exists elsewhere on the account is not something a confined credential learns for free.
func (s *Store) Tags(ctx context.Context, principalID string, scope *filter.Node) ([]Tag, error) {
	where, args := scopeClause(principalID, scope)
	// Where they were dragged to first, then the rest alphabetically. A tag nobody has moved
	// has no row in tag_order, and sorts after every tag that does — new tags arrive at the end
	// rather than in the middle of an arrangement somebody made.
	rows, err := s.reader.QueryContext(ctx,
		`SELECT task_tags.slug, MIN(COALESCE(tag_order.position, `+unplaced+`)) AS place
		   FROM task_tags
		   JOIN tasks ON tasks.seq = task_tags.task_seq
		   LEFT JOIN tag_order ON tag_order.principal_id = tasks.principal_id
		                      AND tag_order.slug = task_tags.slug
		  WHERE `+where+`
		  GROUP BY task_tags.slug
		  ORDER BY place, task_tags.slug`, args...)
	if err != nil {
		return nil, fmt.Errorf("list tags: %w", err)
	}
	defer rows.Close()

	out := []Tag{}
	for rows.Next() {
		var slug string
		var place int64
		if err := rows.Scan(&slug, &place); err != nil {
			return nil, err
		}
		out = append(out, TagOf(slug))
	}
	return out, rows.Err()
}

// unplaced sorts a tag nobody has dragged after every tag somebody has.
const unplaced = "1000000"

// TagOrderMax is how many slugs an arrangement may name. Larger than any cloud anybody can read,
// and small enough that the list is one statement.
const TagOrderMax = 512

// SetTagOrder records where the tags have been dragged to.
//
// The whole arrangement at once rather than one move at a time: the client knows the order it is
// showing, and sending that is one write against a race between two drags in two windows.
//
// Slugs nothing carries are kept rather than refused. A tag goes out of use whenever its last
// task is finished off, and an arrangement that threw those away would rearrange itself behind
// somebody's back.
func (s *Store) SetTagOrder(ctx context.Context, principalID string, slugs []string) error {
	if len(slugs) > TagOrderMax {
		return Invalid("That is more than %d tags in one arrangement.", TagOrderMax)
	}
	seen := map[string]bool{}
	clean := make([]string, 0, len(slugs))
	for _, raw := range slugs {
		slug := NormalizeSlug(raw)
		if !filter.ValidSlug(slug) {
			return Invalid("%q is not a tag.", raw)
		}
		if seen[slug] {
			continue
		}
		seen[slug] = true
		clean = append(clean, slug)
	}

	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		`DELETE FROM tag_order WHERE principal_id = ?`, principalID); err != nil {
		return fmt.Errorf("set tag order: %w", err)
	}
	for at, slug := range clean {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO tag_order (principal_id, slug, position) VALUES (?, ?, ?)`,
			principalID, slug, at); err != nil {
			return fmt.Errorf("set tag order: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("set tag order: %w", err)
	}
	s.changed(principalID)
	return nil
}

// RenameTag moves a slug on every task the caller can reach, and reports how many.
//
// For a session that is the whole account; for a scoped token it is the scope, which makes it a
// partial operation — the honest outcome, since renaming everywhere would let a confined
// credential relabel tasks it cannot read.
func (s *Store) RenameTag(ctx context.Context, principalID string, scope *filter.Node, from, to string) (int64, error) {
	to = NormalizeSlug(to)
	if !filter.ValidSlug(to) {
		return 0, Invalid("%q is not a tag: tags are lowercase letters, digits, - and _.", to)
	}
	if from == to {
		return 0, nil
	}
	where, args := scopeClause(principalID, scope)

	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	// Renaming onto a slug already in use is a merge. The primary key makes the overlap a
	// no-op, so the tasks carrying both end up carrying one.
	sel := `SELECT task_seq FROM tasks JOIN task_tags ON task_tags.task_seq = tasks.seq
	         WHERE ` + where + ` AND task_tags.slug = ?`
	if _, err := tx.ExecContext(ctx,
		`INSERT OR IGNORE INTO task_tags (task_seq, slug) SELECT task_seq, ? FROM (`+sel+`)`,
		append([]any{to}, append(append([]any{}, args...), from)...)...); err != nil {
		return 0, fmt.Errorf("rename tag: %w", err)
	}
	res, err := tx.ExecContext(ctx,
		`DELETE FROM task_tags WHERE slug = ? AND task_seq IN (SELECT seq FROM tasks WHERE `+where+`)`,
		append([]any{from}, args...)...)
	if err != nil {
		return 0, fmt.Errorf("rename tag: %w", err)
	}
	n, _ := res.RowsAffected()
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	if n > 0 {
		s.changed(principalID)
	}
	return n, nil
}

// RemoveTag takes a slug off every task the caller can reach, and reports how many.
//
// Not a delete of anything: the tag stops existing because nothing says it any more.
func (s *Store) RemoveTag(ctx context.Context, principalID string, scope *filter.Node, slug string) (int64, error) {
	where, args := scopeClause(principalID, scope)
	res, err := s.writer.ExecContext(ctx,
		`DELETE FROM task_tags WHERE slug = ? AND task_seq IN (SELECT seq FROM tasks WHERE `+where+`)`,
		append([]any{slug}, args...)...)
	if err != nil {
		return 0, fmt.Errorf("remove tag: %w", err)
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		s.changed(principalID)
	}
	return n, nil
}

// scopeClause is the WHERE every scoped read and write shares.
func scopeClause(principalID string, scope *filter.Node) (string, []any) {
	where := "tasks.principal_id = ?"
	args := []any{principalID}
	if scope != nil {
		sql, scopeArgs := filter.Compile(scope, "tasks.seq")
		where += " AND " + sql
		args = append(args, scopeArgs...)
	}
	return where, args
}

func loadTags(ctx context.Context, q querier, seq int64) ([]string, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT slug FROM task_tags WHERE task_seq = ? ORDER BY slug`, seq)
	if err != nil {
		return nil, fmt.Errorf("task tags: %w", err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var slug string
		if err := rows.Scan(&slug); err != nil {
			return nil, err
		}
		out = append(out, slug)
	}
	return out, rows.Err()
}

func writeTags(ctx context.Context, tx *sql.Tx, seq int64, tags []string) error {
	for _, slug := range tags {
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO task_tags (task_seq, slug) VALUES (?, ?)`, seq, slug); err != nil {
			return fmt.Errorf("write tags: %w", err)
		}
	}
	return nil
}

// replaceTags sets a task's tags and reports whether the set moved.
func replaceTags(ctx context.Context, tx *sql.Tx, seq int64, was, now []string) (bool, error) {
	if sameSet(was, now) {
		return false, nil
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM task_tags WHERE task_seq = ?`, seq); err != nil {
		return false, fmt.Errorf("replace tags: %w", err)
	}
	return true, writeTags(ctx, tx, seq, now)
}

func sameSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	in := map[string]bool{}
	for _, v := range a {
		in[v] = true
	}
	for _, v := range b {
		if !in[v] {
			return false
		}
	}
	return true
}
