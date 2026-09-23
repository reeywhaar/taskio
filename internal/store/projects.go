package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"taskio/internal/filter"
	"taskio/internal/ids"
)

// Sizes. A slug is capped like a tag, because it goes in the same URL.
const (
	ProjectNameMax = 40
	ProjectSlugMax = 40
)

// Project is a hard separation of an account's tasks: each one with its own tags, its own
// arrangement of them and its own groups. Every task is in exactly one.
type Project struct {
	ID          string
	PrincipalID string
	Name        string
	// Slug is what the URL and an agent say. Derived from the name when the project is made,
	// and only changed by somebody changing it — so a link keeps working through a rename.
	Slug string
	// Default is where a request that names no project goes. It can be renamed and it is still
	// the default; it cannot be deleted, because a bare URL has to mean somewhere.
	Default   bool
	CreatedAt time.Time
	// DeletedAt is set on a project that was deleted. The row stays, so a token that reached it
	// can be told the project was deleted rather than that it never existed.
	DeletedAt *time.Time
}

var projectSlugRE = regexp.MustCompile(`^[a-z0-9-]{1,40}$`)

// ProjectSlug is the slug a name suggests: lowercase, digits kept, everything else a hyphen.
func ProjectSlug(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	slug := strings.Trim(regexp.MustCompile(`-+`).ReplaceAllString(b.String(), "-"), "-")
	if len(slug) > ProjectSlugMax {
		slug = strings.Trim(slug[:ProjectSlugMax], "-")
	}
	return slug
}

func validProjectName(name string) (string, error) {
	name = strings.TrimSpace(name)
	switch {
	case name == "":
		return "", Invalid("A project needs a name.")
	case len([]rune(name)) > ProjectNameMax:
		return "", Invalid("That name is longer than %d characters.", ProjectNameMax)
	}
	return name, nil
}

func validProjectSlug(slug string) (string, error) {
	slug = strings.TrimSpace(slug)
	if !projectSlugRE.MatchString(slug) {
		return "", Invalid("A project's slug is lowercase letters, digits and hyphens, at most %d.", ProjectSlugMax)
	}
	return slug, nil
}

const projectColumns = `id, principal_id, name, slug, is_default, created_at, deleted_at`

func scanProject(row interface{ Scan(...any) error }) (*Project, error) {
	var (
		p       Project
		created int64
		deleted sql.NullInt64
	)
	if err := row.Scan(&p.ID, &p.PrincipalID, &p.Name, &p.Slug, &p.Default, &created, &deleted); err != nil {
		return nil, err
	}
	p.CreatedAt = time.Unix(created, 0).UTC()
	p.DeletedAt = nullTime(deleted)
	return &p, nil
}

// Projects lists an account's live projects in the order they were dragged into.
func (s *Store) Projects(ctx context.Context, principalID string) ([]*Project, error) {
	rows, err := s.reader.QueryContext(ctx,
		`SELECT `+projectColumns+` FROM projects
		  WHERE principal_id = ? AND deleted_at IS NULL
		  ORDER BY position, created_at, id`, principalID)
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	defer rows.Close()
	out := []*Project{}
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ProjectByID reads one, deleted or not: whoever holds an id is owed the answer "it was
// deleted" rather than silence.
func (s *Store) ProjectByID(ctx context.Context, principalID, id string) (*Project, error) {
	p, err := scanProject(s.reader.QueryRowContext(ctx,
		`SELECT `+projectColumns+` FROM projects WHERE principal_id = ? AND id = ?`, principalID, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, NotFound("There is no such project.")
	}
	if err != nil {
		return nil, fmt.Errorf("project: %w", err)
	}
	return p, nil
}

// ProjectBySlug is the live project with that slug — or, when none is, the answer that one was
// deleted, which is what a link or an agent still naming it needs to hear.
func (s *Store) ProjectBySlug(ctx context.Context, principalID, slug string) (*Project, error) {
	p, err := scanProject(s.reader.QueryRowContext(ctx,
		`SELECT `+projectColumns+` FROM projects
		  WHERE principal_id = ? AND slug = ?
		  ORDER BY deleted_at IS NULL DESC, deleted_at DESC LIMIT 1`, principalID, slug))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, NotFound("There is no project %s.", slug)
	}
	if err != nil {
		return nil, fmt.Errorf("project: %w", err)
	}
	if p.DeletedAt != nil {
		return nil, Gone("Project %s was deleted.", slug)
	}
	return p, nil
}

// DefaultProject is where a request that names no project goes.
func (s *Store) DefaultProject(ctx context.Context, principalID string) (*Project, error) {
	p, err := scanProject(s.reader.QueryRowContext(ctx,
		`SELECT `+projectColumns+` FROM projects WHERE principal_id = ? AND is_default = 1`, principalID))
	if err != nil {
		return nil, fmt.Errorf("default project: %w", err)
	}
	return p, nil
}

// createDefaultProject gives a new account the project its first task goes into.
func createDefaultProject(ctx context.Context, tx *sql.Tx, principalID string, now time.Time) error {
	_, err := tx.ExecContext(ctx,
		`INSERT INTO projects (id, principal_id, name, slug, is_default, position, created_at)
		 VALUES (?, ?, 'Main', 'main', 1, 0, ?)`,
		ids.New(ids.Project, now.UnixMilli()), principalID, unix(now))
	if err != nil {
		return fmt.Errorf("default project: %w", err)
	}
	return nil
}

// CreateProject makes one at the end of the rail. An empty slug is derived from the name.
func (s *Store) CreateProject(ctx context.Context, principalID, name, slug string) (*Project, error) {
	name, err := validProjectName(name)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(slug) == "" {
		slug = ProjectSlug(name)
	}
	if slug, err = validProjectSlug(slug); err != nil {
		return nil, err
	}
	now := s.Now()
	p := &Project{
		ID:          ids.New(ids.Project, now.UnixMilli()),
		PrincipalID: principalID,
		Name:        name,
		Slug:        slug,
		CreatedAt:   now,
	}
	_, err = s.writer.ExecContext(ctx,
		`INSERT INTO projects (id, principal_id, name, slug, position, created_at)
		 VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM projects WHERE principal_id = ?), ?)`,
		p.ID, principalID, name, slug, principalID, unix(now))
	if isUnique(err) {
		return nil, Conflict("There is already a project called %s.", slug)
	}
	if err != nil {
		return nil, fmt.Errorf("create project: %w", err)
	}
	s.changed(principalID)
	return p, nil
}

// UpdateProject renames one, or changes its slug, or both. A nil field is left alone.
//
// The slug changes only when it is asked to. Anything that named the old one — a bookmark, an
// agent's ?project= — stops finding it, which is the whole reason it is not derived again from
// a new name.
func (s *Store) UpdateProject(ctx context.Context, principalID, id string, name, slug *string) (*Project, error) {
	p, err := s.ProjectByID(ctx, principalID, id)
	if err != nil {
		return nil, err
	}
	if p.DeletedAt != nil {
		return nil, Gone("That project was deleted.")
	}
	if name != nil {
		if p.Name, err = validProjectName(*name); err != nil {
			return nil, err
		}
	}
	if slug != nil {
		if p.Slug, err = validProjectSlug(*slug); err != nil {
			return nil, err
		}
	}
	res, err := s.writer.ExecContext(ctx,
		`UPDATE projects SET name = ?, slug = ?
		  WHERE principal_id = ? AND id = ? AND (name <> ? OR slug <> ?)`,
		p.Name, p.Slug, principalID, id, p.Name, p.Slug)
	if isUnique(err) {
		return nil, Conflict("There is already a project called %s.", p.Slug)
	}
	if err != nil {
		return nil, fmt.Errorf("update project: %w", err)
	}
	if n, _ := res.RowsAffected(); n > 0 {
		s.changed(principalID)
	}
	return p, nil
}

// SetProjectOrder records the order the rail was dragged into. Ids it does not name keep
// their place after the ones it does.
func (s *Store) SetProjectOrder(ctx context.Context, principalID string, order []string) error {
	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for at, id := range order {
		if _, err := tx.ExecContext(ctx,
			`UPDATE projects SET position = ? WHERE principal_id = ? AND id = ?`, at, principalID, id); err != nil {
			return fmt.Errorf("set project order: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.changed(principalID)
	return nil
}

// DeleteProject deletes it and everything in it: its tasks, its groups, the arrangement of its
// tags. The row stays behind, marked, so a token that reached it is told what happened.
//
// Tokens are left alone. One that reached this project and others keeps reaching the others,
// and asking for this one is answered "was deleted" — a credential edited out from under
// whatever holds it is a worse surprise than a clear refusal.
func (s *Store) DeleteProject(ctx context.Context, principalID, id string) error {
	p, err := s.ProjectByID(ctx, principalID, id)
	if err != nil {
		return err
	}
	if p.Default {
		return Invalid("The default project cannot be deleted. It is where a link with no project goes.")
	}
	if p.DeletedAt != nil {
		return nil
	}
	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, q := range []string{
		`DELETE FROM tasks WHERE principal_id = ? AND project_id = ?`,
		`DELETE FROM groups WHERE principal_id = ? AND project_id = ?`,
	} {
		if _, err := tx.ExecContext(ctx, q, principalID, id); err != nil {
			return fmt.Errorf("delete project: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM tag_order WHERE project_id = ?`, id); err != nil {
		return fmt.Errorf("delete project: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE projects SET deleted_at = ? WHERE principal_id = ? AND id = ?`,
		unix(s.Now()), principalID, id); err != nil {
		return fmt.Errorf("delete project: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.changed(principalID)
	return nil
}

// Reach is what a credential may touch: each project it reaches, and the filter confining it
// there — nil for the whole of that project. A nil Reach is a session, which reaches
// everything the account has.
type Reach map[string]*filter.Node

// Reaches reports whether it may touch the project at all.
func (r Reach) Reaches(projectID string) bool {
	if r == nil {
		return true
	}
	_, ok := r[projectID]
	return ok
}

// Allows reports whether a task is one this reach may touch.
func (r Reach) Allows(t *Task) bool {
	if r == nil {
		return true
	}
	scope, ok := r[t.ProjectID]
	return ok && filter.Match(scope, t.Tags)
}

// Scope is the filter confining it inside one project, or nil for all of it.
func (r Reach) Scope(projectID string) *filter.Node {
	if r == nil {
		return nil
	}
	return r[projectID]
}

// Requires is what a task written into a project has to carry.
func (r Reach) Requires(projectID string) []string {
	return filter.Slugs(r.Scope(projectID))
}

// check is whether a task written into a project carries what this reach requires there: every
// tag of an and(), and at least one of an or() — several tags picked for a token mean any of
// them. Nothing is added for the writer; the refusal names what would do.
func (r Reach) check(projectID string, tags []string) error {
	scope := r.Scope(projectID)
	if scope == nil {
		return nil
	}
	need := filter.Slugs(scope)
	if scope.Op == filter.Or {
		for _, slug := range need {
			if contains(tags, slug) {
				return nil
			}
		}
		return TagsRequiredAny(need)
	}
	var missing []string
	for _, slug := range need {
		if !contains(tags, slug) {
			missing = append(missing, slug)
		}
	}
	if len(missing) > 0 {
		return TagsRequired(missing)
	}
	return nil
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
