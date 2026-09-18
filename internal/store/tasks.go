package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"taskio/internal/filter"
	"taskio/internal/ids"
)

// Sizes. A title is capped in runes because a sentence is not four times as long for being
// written in a four-byte script; a description in bytes, because what it holds is markdown and
// image links rather than prose alone.
const (
	TitleMaxRunes  = 200
	DescriptionMax = 64 << 10
	TagsMax        = 32
	BulkMax        = 500
)

// Status values, rendered from the two timestamps rather than stored beside them.
const (
	StatusTodo = "todo"
	StatusDone = "done"
	// StatusDeleted is a task somebody threw away. It is a kind of finished rather than a
	// fourth thing: it carries done_at as well, so it leaves the todo list, turns up in the
	// finished one where it can be put back, and is swept on the same ninety days.
	StatusDeleted = "deleted"
	StatusAll     = "all"
)

// Task is one row, with its tags.
type Task struct {
	Seq         int64
	ID          string
	PrincipalID string
	Title       string
	Description string
	Tags        []string
	Priority    int
	Pinned      bool
	// Color is #rrggbb, or empty for none. It has no meaning here: whoever writes it decides
	// what it means, and nothing sorts or filters by it.
	Color     string
	CreatedAt time.Time
	UpdatedAt time.Time
	DoneAt    *time.Time
	// DeletedAt is when it was thrown away, and implies DoneAt.
	DeletedAt *time.Time
}

// Status renders the timestamps. One fact, one column: a status column beside a timestamp is
// two facts that can disagree.
//
// Deleted wins over done because it is the more particular answer: every deleted task is also
// done, and "deleted" is the word for how it got that way.
func (t *Task) Status() string {
	switch {
	case t.DeletedAt != nil:
		return StatusDeleted
	case t.DoneAt != nil:
		return StatusDone
	}
	return StatusTodo
}

// TaskQuery is everything GET /api/tasks can ask.
type TaskQuery struct {
	Filter *filter.Node
	Status string
	// Pinned narrows to pinned or unpinned when set; unset asks about neither.
	Pinned *bool
	Limit  int
	Cursor *Cursor
}

// CreateTask writes one, with its tags, in one transaction.
// TaskNew is what a task is written with.
//
// A struct rather than a row of arguments: the fields are all optional but the title, and
// named at the call site they cannot be handed over in the wrong order or read as a bare
// literal that means nothing until you open this file.
type TaskNew struct {
	Title       string
	Description string
	Tags        []string
	Priority    int
	Pinned      bool
	Color       string
}

func (s *Store) CreateTask(ctx context.Context, principalID string, scope []string, in TaskNew) (*Task, error) {
	title, description, tags := in.Title, in.Description, in.Tags
	title, err := validTitle(title)
	if err != nil {
		return nil, err
	}
	color, err := validColor(in.Color)
	if err != nil {
		return nil, err
	}
	if err := validDescription(description); err != nil {
		return nil, err
	}
	tags, err = validTags(tags)
	if err != nil {
		return nil, err
	}

	// Inline images become assets and the text is rewritten before it is stored, so a stored
	// description never contains a data: URI and the cap below measures prose.
	if description, err = s.inlineAssets(ctx, principalID, description); err != nil {
		return nil, err
	}
	title = s.normalizeMentions(ctx, principalID, scope, title)
	description = s.normalizeMentions(ctx, principalID, scope, description)

	now := s.Now()
	task := &Task{
		PrincipalID: principalID,
		Title:       title,
		Description: description,
		Tags:        tags,
		Priority:    in.Priority,
		Pinned:      in.Pinned,
		Color:       color,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// Minting is one random read; a clash is caught by the UNIQUE index. At any size this
	// will see the first attempt succeeds, and the loop is here for the one that does not.
	for attempt := 0; ; attempt++ {
		task.ID = ids.NewTask()
		res, err := tx.ExecContext(ctx,
			`INSERT INTO tasks (id, principal_id, title, description, priority, pinned, color, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			task.ID, principalID, title, description, in.Priority, in.Pinned, color, unix(now), unix(now))
		if err == nil {
			task.Seq, _ = res.LastInsertId()
			break
		}
		if !isUnique(err) || attempt > 8 {
			return nil, fmt.Errorf("create task: %w", err)
		}
	}

	// Before the tags are written, so a slug nobody has used before joins the arrangement at
	// the end rather than wherever its first letter would put it.
	if err := noteTags(ctx, tx, principalID, tags); err != nil {
		return nil, err
	}
	if err := writeTags(ctx, tx, task.Seq, tags); err != nil {
		return nil, err
	}
	if err := syncContent(ctx, tx, task.Seq, principalID, scope, title, description); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	s.changed(principalID)
	return task, nil
}

// TaskPatch is what PATCH can change. Pointers, so absent leaves a field alone and empty
// clears it.
type TaskPatch struct {
	Title       *string
	Description *string
	Tags        *[]string
	Priority    *int
	Pinned      *bool
	Color       *string
}

// UpdateTask applies a patch and reports the task as it now stands.
//
// The UPDATE carries its own comparison, so a save that changes nothing does not move
// updated_at and does not mark the database changed — SQLite reports a row affected for an
// UPDATE writing identical values, so asking in the WHERE is what makes the answer mean
// anything.
func (s *Store) UpdateTask(ctx context.Context, principalID string, scope []string, id string, patch TaskPatch) (*Task, error) {
	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	task, err := loadTask(ctx, tx, principalID, id)
	if err != nil {
		return nil, err
	}

	title, description := task.Title, task.Description
	if patch.Title != nil {
		if title, err = validTitle(*patch.Title); err != nil {
			return nil, err
		}
	}
	if patch.Description != nil {
		if description, err = s.inlineAssets(ctx, principalID, *patch.Description); err != nil {
			return nil, err
		}
		if err := validDescription(description); err != nil {
			return nil, err
		}
	}
	if patch.Title != nil {
		title = s.normalizeMentions(ctx, principalID, scope, title)
	}
	if patch.Description != nil {
		description = s.normalizeMentions(ctx, principalID, scope, description)
	}

	priority := task.Priority
	if patch.Priority != nil {
		priority = *patch.Priority
	}
	pinned := task.Pinned
	if patch.Pinned != nil {
		pinned = *patch.Pinned
	}
	color := task.Color
	if patch.Color != nil {
		var err error
		if color, err = validColor(*patch.Color); err != nil {
			return nil, err
		}
	}

	moved := false
	now := s.Now()
	res, err := tx.ExecContext(ctx,
		`UPDATE tasks SET title = ?, description = ?, priority = ?, pinned = ?, color = ?, updated_at = ?
		  WHERE seq = ? AND (title <> ? OR description <> ? OR priority <> ? OR pinned <> ?
		                     OR color <> ?)`,
		title, description, priority, pinned, color, unix(now),
		task.Seq, title, description, priority, pinned, color)
	if err != nil {
		return nil, fmt.Errorf("update task: %w", err)
	}
	if n, _ := res.RowsAffected(); n > 0 {
		moved = true
		task.Title, task.Description, task.Priority, task.Pinned, task.Color, task.UpdatedAt = title, description, priority, pinned, color, now
		// Both joins are rebuilt from the saved text, so neither can drift from the words.
		if err := syncContent(ctx, tx, task.Seq, principalID, scope, title, description); err != nil {
			return nil, err
		}
	}

	if patch.Tags != nil {
		tags, err := validTags(*patch.Tags)
		if err != nil {
			return nil, err
		}
		if err := noteTags(ctx, tx, principalID, tags); err != nil {
			return nil, err
		}
		changed, err := replaceTags(ctx, tx, task.Seq, task.Tags, tags)
		if err != nil {
			return nil, err
		}
		if changed {
			moved = true
			task.Tags = tags
			if _, err := tx.ExecContext(ctx, `UPDATE tasks SET updated_at = ? WHERE seq = ?`,
				unix(now), task.Seq); err != nil {
				return nil, fmt.Errorf("update task: %w", err)
			}
			task.UpdatedAt = now
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	if moved {
		s.changed(principalID)
	}
	return task, nil
}

// SetDone marks a task done or undone.
//
// Marking an already-done task done is a success and does not move done_at: two agents, or an
// agent and a person, finishing the same thing is not an error, and re-stamping it would reset
// the ninety-day sweep.
//
// Undone puts a deleted task back as well. There is no third verb for that and there should not
// be: what somebody means by taking a task out of the finished list is the same thing whichever
// way it got there, and a task that is on the list again is not deleted by any reading.
func (s *Store) SetDone(ctx context.Context, principalID, id string, done bool) (*Task, error) {
	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	task, err := loadTask(ctx, tx, principalID, id)
	if err != nil {
		return nil, err
	}
	if (task.DoneAt != nil) == done && (done || task.DeletedAt == nil) {
		return task, nil
	}

	now := s.Now()
	var at any
	if done {
		at = unix(now)
	}
	// deleted_at goes with it: undone means back on the list, and a task on the list is not a
	// deleted one. Marking one done leaves the mark alone — it is already both.
	if _, err := tx.ExecContext(ctx,
		`UPDATE tasks SET done_at = ?, deleted_at = CASE WHEN ? THEN deleted_at END, updated_at = ?
		  WHERE seq = ?`, at, done, unix(now), task.Seq); err != nil {
		return nil, fmt.Errorf("set done: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	s.changed(principalID)

	if done {
		task.DoneAt = &now
	} else {
		task.DoneAt = nil
		task.DeletedAt = nil
	}
	task.UpdatedAt = now
	return task, nil
}

// DeleteTask marks one deleted, which is a kind of finished rather than an absence.
//
// It stamps done_at too where there is none, and that is what makes the rest of the program need
// no changes: the task drops out of the todo list, appears at the top of the finished one where
// somebody can put it back, and is collected by the ninety-day sweep on the same terms as
// anything else that is over.
//
// Deleting an already-deleted task is a success and moves nothing, on the same reasoning as
// marking a done task done: two agents doing it is not an error, and re-stamping would reset
// the sweep on a task that has been sitting there for a month.
func (s *Store) DeleteTask(ctx context.Context, principalID, id string) error {
	now := unix(s.Now())
	res, err := s.writer.ExecContext(ctx,
		`UPDATE tasks
		    SET deleted_at = ?, done_at = COALESCE(done_at, ?), updated_at = ?
		  WHERE principal_id = ? AND id = ? AND deleted_at IS NULL`,
		now, now, now, principalID, id)
	if err != nil {
		return fmt.Errorf("delete task: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		// Nothing moved: either there is no such task, or it was already thrown away.
		if _, err := loadTask(ctx, s.reader, principalID, id); err != nil {
			return err
		}
		return nil
	}
	s.changed(principalID)
	return nil
}

// Task returns one by its id or by an unambiguous prefix of it.
func (s *Store) Task(ctx context.Context, principalID, ref string) (*Task, error) {
	id, err := s.ResolveTask(ctx, principalID, ref)
	if err != nil {
		return nil, err
	}
	return loadTask(ctx, s.reader, principalID, id)
}

// ResolveTask turns a typed reference into one id.
//
// Resolution happens inside what the caller can see, not against the table with a check
// afterwards: resolve first and check second, and a prefix matching one of my tasks and one of
// yours reveals that somebody else's exists.
func (s *Store) ResolveTask(ctx context.Context, principalID, ref string) (string, error) {
	normal, err := ids.NormalizeTask(ref)
	if err != nil {
		return "", Invalid("%s", err.Error())
	}
	if ids.IsFullTask(normal) {
		return normal, nil
	}

	lo, hi := ids.PrefixBounds(normal)
	rows, err := s.reader.QueryContext(ctx,
		`SELECT id FROM tasks WHERE principal_id = ? AND id >= ? AND id < ? LIMIT 2`,
		principalID, lo, hi)
	if err != nil {
		return "", fmt.Errorf("resolve task: %w", err)
	}
	defer rows.Close()

	var found []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return "", err
		}
		found = append(found, id)
	}
	switch len(found) {
	case 0:
		return "", NotFound("There is no task %s.", normal)
	case 1:
		return found[0], nil
	}
	// Well formed, and does not name one thing: a conflict among what exists rather than a
	// mistake in what was sent. The candidates are all the caller's own.
	return "", Ambiguous("%s names more than one task: %s. Give another character or two.",
		normal, strings.Join(found, ", "))
}

func loadTask(ctx context.Context, q querier, principalID, id string) (*Task, error) {
	var (
		t                Task
		created, updated int64
		done, deleted    sql.NullInt64
	)
	err := q.QueryRowContext(ctx,
		`SELECT `+taskColumns+` FROM tasks WHERE principal_id = ? AND id = ?`, principalID, id).
		Scan(&t.Seq, &t.ID, &t.PrincipalID, &t.Title, &t.Description,
			&t.Priority, &t.Pinned, &t.Color, &created, &updated, &done, &deleted)
	if errors.Is(err, sql.ErrNoRows) {
		// Somebody else's task is 404 rather than 403: whether a stranger keeps a task is not
		// the caller's business either way.
		return nil, NotFound("There is no task %s.", id)
	}
	if err != nil {
		return nil, fmt.Errorf("task: %w", err)
	}
	t.CreatedAt = time.Unix(created, 0).UTC()
	t.UpdatedAt = time.Unix(updated, 0).UTC()
	if done.Valid {
		at := time.Unix(done.Int64, 0).UTC()
		t.DoneAt = &at
	}
	if deleted.Valid {
		at := time.Unix(deleted.Int64, 0).UTC()
		t.DeletedAt = &at
	}
	t.Tags, err = loadTags(ctx, q, t.Seq)
	return &t, err
}

// querier is whatever can run a query: the reader pool, the writer, or a transaction.
type querier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func validTitle(title string) (string, error) {
	title = strings.TrimSpace(title)
	switch {
	case title == "":
		return "", Invalid("A task needs a title.")
	case len([]rune(title)) > TitleMaxRunes:
		return "", Invalid("That title is longer than %d characters.", TitleMaxRunes)
	}
	return title, nil
}

func validDescription(description string) error {
	if len(description) > DescriptionMax {
		return Invalid("That description is larger than %d KB.", DescriptionMax>>10)
	}
	return nil
}

func validTags(tags []string) ([]string, error) {
	if len(tags) > TagsMax {
		return nil, Invalid("That is more than %d tags on one task.", TagsMax)
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(tags))
	for _, raw := range tags {
		slug := NormalizeSlug(raw)
		if !filter.ValidSlug(slug) {
			return nil, Invalid("%q is not a tag: tags are lowercase letters, digits, - and _, and cannot be and, or or not.", raw)
		}
		if seen[slug] {
			continue
		}
		seen[slug] = true
		out = append(out, slug)
	}
	return out, nil
}
