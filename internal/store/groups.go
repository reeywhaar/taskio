package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"taskio/internal/ids"
)

// GroupNameMax is how long a name may be. It is read in a rail 12rem wide.
const GroupNameMax = 40

// Group is a named set of tags: the filter somebody uses often enough to want it in the rail.
//
// Its tags need not be tags anything carries. A tag exists here only because something wrote it
// down, and naming a group is often where somebody decides one exists — so a group is written
// as asked rather than checked against the tags in use.
type Group struct {
	ID          string
	PrincipalID string
	Name        string
	Tags        []string
	CreatedAt   time.Time
}

// Groups lists an account's, oldest first, so adding one does not move the others.
func (s *Store) Groups(ctx context.Context, principalID string) ([]*Group, error) {
	rows, err := s.reader.QueryContext(ctx,
		`SELECT id, name, created_at FROM groups
		  WHERE principal_id = ? ORDER BY created_at, id`, principalID)
	if err != nil {
		return nil, fmt.Errorf("list groups: %w", err)
	}
	defer rows.Close()

	out := []*Group{}
	byID := map[string]*Group{}
	for rows.Next() {
		g := &Group{PrincipalID: principalID, Tags: []string{}}
		var created int64
		if err := rows.Scan(&g.ID, &g.Name, &created); err != nil {
			return nil, err
		}
		g.CreatedAt = time.Unix(created, 0).UTC()
		out = append(out, g)
		byID[g.ID] = g
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return out, nil
	}

	// One query for every group's tags rather than one per group: the rail draws them all.
	tags, err := s.reader.QueryContext(ctx,
		`SELECT group_tags.group_id, group_tags.slug
		   FROM group_tags JOIN groups ON groups.id = group_tags.group_id
		  WHERE groups.principal_id = ?
		  ORDER BY group_tags.slug`, principalID)
	if err != nil {
		return nil, fmt.Errorf("list group tags: %w", err)
	}
	defer tags.Close()
	for tags.Next() {
		var id, slug string
		if err := tags.Scan(&id, &slug); err != nil {
			return nil, err
		}
		if g := byID[id]; g != nil {
			g.Tags = append(g.Tags, slug)
		}
	}
	return out, tags.Err()
}

// CreateGroup writes one, with its tags, in one transaction.
func (s *Store) CreateGroup(ctx context.Context, principalID, name string, tags []string) (*Group, error) {
	name, slugs, err := validGroup(name, tags)
	if err != nil {
		return nil, err
	}

	g := &Group{
		ID:          ids.New(ids.Group, s.Now().UnixMilli()),
		PrincipalID: principalID,
		Name:        name,
		Tags:        slugs,
		CreatedAt:   s.Now(),
	}
	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO groups (id, principal_id, name, created_at) VALUES (?, ?, ?, ?)`,
		g.ID, principalID, g.Name, unix(g.CreatedAt)); err != nil {
		return nil, fmt.Errorf("create group: %w", err)
	}
	if err := writeGroupTags(ctx, tx, g.ID, g.Tags); err != nil {
		return nil, fmt.Errorf("create group: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("create group: %w", err)
	}
	s.changed(principalID)
	return g, nil
}

// UpdateGroup replaces a group's name and tags together.
//
// Both at once because the dialog that edits one edits both, and a group whose name says work
// and whose tags say home is a group somebody half-saved.
func (s *Store) UpdateGroup(ctx context.Context, principalID, id, name string, tags []string) (*Group, error) {
	name, slugs, err := validGroup(name, tags)
	if err != nil {
		return nil, err
	}

	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	g := &Group{ID: id, PrincipalID: principalID, Name: name, Tags: slugs}
	res, err := tx.ExecContext(ctx,
		`UPDATE groups SET name = ? WHERE principal_id = ? AND id = ?`, name, principalID, id)
	if err != nil {
		return nil, fmt.Errorf("update group: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, NotFound("There is no such group.")
	}
	var created int64
	if err := tx.QueryRowContext(ctx,
		`SELECT created_at FROM groups WHERE id = ?`, id).Scan(&created); err != nil {
		return nil, fmt.Errorf("update group: %w", err)
	}
	g.CreatedAt = time.Unix(created, 0).UTC()
	if _, err := tx.ExecContext(ctx, `DELETE FROM group_tags WHERE group_id = ?`, id); err != nil {
		return nil, fmt.Errorf("update group: %w", err)
	}
	if err := writeGroupTags(ctx, tx, id, slugs); err != nil {
		return nil, fmt.Errorf("update group: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("update group: %w", err)
	}
	s.changed(principalID)
	return g, nil
}

// DeleteGroup removes one. Its tags go by cascade, and no task is touched: a group names tags,
// it does not own them.
func (s *Store) DeleteGroup(ctx context.Context, principalID, id string) error {
	res, err := s.writer.ExecContext(ctx,
		`DELETE FROM groups WHERE principal_id = ? AND id = ?`, principalID, id)
	if err != nil {
		return fmt.Errorf("delete group: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return NotFound("There is no such group.")
	}
	s.changed(principalID)
	return nil
}

func writeGroupTags(ctx context.Context, tx *sql.Tx, id string, slugs []string) error {
	for _, slug := range slugs {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO group_tags (group_id, slug) VALUES (?, ?)`, id, slug); err != nil {
			return err
		}
	}
	return nil
}

// validGroup checks the two fields together, since both routes that write a group write both.
//
// A group with no tags is refused: it would be the All group, which is not stored and cannot be
// deleted, and a second one of those is a row that does nothing.
func validGroup(name string, tags []string) (string, []string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", nil, Invalid("A group needs a name.")
	}
	if len([]rune(name)) > GroupNameMax {
		return "", nil, Invalid("That name is longer than %d characters.", GroupNameMax)
	}
	// Checked here as well as in validTags, which counts what fits on a task.
	if len(tags) > TagsMax {
		return "", nil, Invalid("That is more than %d tags in one group.", TagsMax)
	}
	slugs, err := validTags(tags)
	if err != nil {
		return "", nil, err
	}
	if len(slugs) == 0 {
		return "", nil, Invalid("A group needs at least one tag. Everything is already a group.")
	}
	return name, slugs, nil
}
