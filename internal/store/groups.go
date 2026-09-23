package store

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
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
	// ProjectID is the project it filters: a group is a saved view of one project's tags.
	ProjectID string
	Name      string
	Tags      []string
	// Color is #rrggbb, or empty for the brand color. What the tab wears while the group is
	// the one being looked at, so two windows are two colors rather than two of the same icon.
	Color     string
	CreatedAt time.Time
}

// A color is six hex digits and nothing else: it reaches a stylesheet and an SVG, and the
// shortest way to be sure neither can be escaped out of is to accept one shape.
var colorRE = regexp.MustCompile(`^#[0-9a-f]{6}$`)

// validColor folds what was sent into the one shape stored, or refuses it. Shared by the two
// things that wear one, so a group and a task cannot disagree about what a color is.
func validColor(color string) (string, error) {
	color = strings.ToLower(strings.TrimSpace(color))
	if color != "" && !colorRE.MatchString(color) {
		return "", Invalid("A color is six hex digits after a hash, like #ef6500.")
	}
	return color, nil
}

// Groups lists an account's in the order they are drawn in: where they were dragged to, then
// oldest first, so a group nobody has moved does not move when another one is added.
func (s *Store) Groups(ctx context.Context, principalID, projectID string) ([]*Group, error) {
	rows, err := s.reader.QueryContext(ctx,
		`SELECT id, name, color, created_at FROM groups
		  WHERE principal_id = ? AND project_id = ? ORDER BY position, created_at, id`, principalID, projectID)
	if err != nil {
		return nil, fmt.Errorf("list groups: %w", err)
	}
	defer rows.Close()

	out := []*Group{}
	byID := map[string]*Group{}
	for rows.Next() {
		g := &Group{PrincipalID: principalID, ProjectID: projectID, Tags: []string{}}
		var created int64
		if err := rows.Scan(&g.ID, &g.Name, &g.Color, &created); err != nil {
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
		  WHERE groups.principal_id = ? AND groups.project_id = ?
		  ORDER BY group_tags.slug`, principalID, projectID)
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
func (s *Store) CreateGroup(ctx context.Context, principalID, projectID, name string, tags []string, color string) (*Group, error) {
	name, slugs, color, err := validGroup(name, tags, color)
	if err != nil {
		return nil, err
	}

	g := &Group{
		ID:          ids.New(ids.Group, s.Now().UnixMilli()),
		PrincipalID: principalID,
		ProjectID:   projectID,
		Name:        name,
		Tags:        slugs,
		Color:       color,
		CreatedAt:   s.Now(),
	}
	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// After the ones already there rather than at position zero, which is where the first
	// arranged group sits: a new group belongs at the end of somebody's arrangement, not tied
	// with the top of it and broken apart by whatever the tiebreak happens to say.
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO groups (id, principal_id, project_id, name, color, created_at, position)
		 VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1
		                              FROM groups WHERE principal_id = ? AND project_id = ?))`,
		g.ID, principalID, projectID, g.Name, g.Color, unix(g.CreatedAt), principalID, projectID); err != nil {
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
func (s *Store) UpdateGroup(ctx context.Context, principalID, id, name string, tags []string, color string) (*Group, error) {
	name, slugs, color, err := validGroup(name, tags, color)
	if err != nil {
		return nil, err
	}

	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	g := &Group{ID: id, PrincipalID: principalID, Name: name, Tags: slugs, Color: color}
	res, err := tx.ExecContext(ctx,
		`UPDATE groups SET name = ?, color = ? WHERE principal_id = ? AND id = ?`,
		name, color, principalID, id)
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

// SetGroupOrder writes where the rail's groups have been dragged to.
//
// The whole arrangement at once rather than one move, like the tag cloud's: the client knows
// the order it is showing, and sending that is one write against a race between two windows.
//
// Ids this does not name keep their place after the ones it does, oldest first. A group written
// in another tab while this one was being dragged then lands at the end rather than at the top,
// which is where a position of zero would have put it.
func (s *Store) SetGroupOrder(ctx context.Context, principalID, projectID string, ids []string) error {
	current, err := s.Groups(ctx, principalID, projectID)
	if err != nil {
		return err
	}

	named := map[string]bool{}
	order := make([]string, 0, len(current))
	for _, id := range ids {
		if named[id] {
			continue
		}
		named[id] = true
		order = append(order, id)
	}
	for _, g := range current {
		if !named[g.ID] {
			order = append(order, g.ID)
		}
	}

	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for at, id := range order {
		if _, err := tx.ExecContext(ctx,
			`UPDATE groups SET position = ? WHERE principal_id = ? AND id = ?`,
			at, principalID, id); err != nil {
			return fmt.Errorf("set group order: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("set group order: %w", err)
	}
	s.changed(principalID)
	return nil
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
func validGroup(name string, tags []string, color string) (string, []string, string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", nil, "", Invalid("A group needs a name.")
	}
	if len([]rune(name)) > GroupNameMax {
		return "", nil, "", Invalid("That name is longer than %d characters.", GroupNameMax)
	}
	// Checked here as well as in validTags, which counts what fits on a task.
	if len(tags) > TagsMax {
		return "", nil, "", Invalid("That is more than %d tags in one group.", TagsMax)
	}
	slugs, err := validTags(tags)
	if err != nil {
		return "", nil, "", err
	}
	if len(slugs) == 0 {
		return "", nil, "", Invalid("A group needs at least one tag. Everything is already a group.")
	}
	color, err = validColor(color)
	if err != nil {
		return "", nil, "", err
	}
	return name, slugs, color, nil
}
