package store

import (
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"taskio/internal/filter"
	"taskio/internal/ids"
	"taskio/internal/search"
)

// Limits on a list. The default is the maximum: an agent asking for a list wants the list, and
// a smaller default would make every caller implement paging to discover there was nothing to
// page.
const (
	ListLimitDefault = 1000
	ListLimitMax     = 1000
)

// Cursor is a place in one ordering.
//
// It carries which ordering it belongs to, so one taken from the done list and replayed against
// the live one is refused rather than walking the wrong sequence. The tiebreak is seq — the
// internal key — because it is monotonic where the public id is not.
//
// Keys is one value per sort column, in the order they sort. The live list sorts on three and
// the done list on one, and an ordering's name is what says how many to expect.
type Cursor struct {
	Order string
	Keys  []int64
	Seq   int64
}

func (c *Cursor) String() string {
	parts := []string{c.Order}
	for _, k := range c.Keys {
		parts = append(parts, strconv.FormatInt(k, 10))
	}
	parts = append(parts, strconv.FormatInt(c.Seq, 10))
	return base64.RawURLEncoding.EncodeToString([]byte(strings.Join(parts, ".")))
}

// ParseCursor reads one back. Opaque by contract, so anything that does not decode is refused.
func ParseCursor(s string) (*Cursor, error) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, Invalid("That cursor is not one this gave out.")
	}
	parts := strings.Split(string(raw), ".")
	if len(parts) < 3 {
		return nil, Invalid("That cursor is not one this gave out.")
	}
	out := &Cursor{Order: parts[0]}
	for _, raw := range parts[1:] {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return nil, Invalid("That cursor is not one this gave out.")
		}
		out.Keys = append(out.Keys, n)
	}
	out.Seq = out.Keys[len(out.Keys)-1]
	out.Keys = out.Keys[:len(out.Keys)-1]
	return out, nil
}

// TaskPage is what a list answers with.
type TaskPage struct {
	Tasks []*Task
	Total int
	Next  *Cursor
}

// orderOf is which keys a status sorts by, outermost first.
//
// A finished list is a record of what happened, so the useful order is the order things were
// finished: a task written in March and done yesterday belongs at the top. Pinning and priority
// are about what to do next, which a finished task no longer has an answer to — so they order
// the live list and leave the record alone.
func orderOf(status string) (columns []string, name string) {
	if status == StatusDone {
		return []string{"done_at"}, "done"
	}
	// The last poke rather than the writing, inside the pin and the priority: a task somebody
	// has just said still stands belongs above one nobody has looked at for a month. Named
	// apart from the order it replaced, so a cursor from that one is refused, not misread.
	return []string{"pinned", "priority", "poked_at"}, "poked"
}

// ListTasks answers a query.
//
// Without a search term this is one page of rows and one count. With one, every matching title
// is scored in Go and the page is the best of them — which turns pagination off, because a
// score is neither in the table nor stable when a task is edited.
func (s *Store) ListTasks(ctx context.Context, principalID, projectID string, scope *filter.Node, q TaskQuery, term string) (*TaskPage, error) {
	where, args := scopeClause(principalID, projectID, scope)
	if q.Filter != nil {
		sql, fargs := filter.Compile(q.Filter, "tasks.seq")
		where += " AND " + sql
		args = append(args, fargs...)
	}
	switch q.Status {
	case StatusTodo, "":
		where += " AND tasks.done_at IS NULL"
	case StatusDone:
		// Deleted tasks are in here too, because deleting stamps done_at: finished with is
		// finished with, and the one place somebody looks for a task they have just thrown
		// away is the list of things that are over.
		where += " AND tasks.done_at IS NOT NULL"
	case StatusDeleted:
		where += " AND tasks.deleted_at IS NOT NULL"
	case StatusAll:
	default:
		return nil, Invalid("status is todo, done, deleted or all.")
	}
	if q.Pinned != nil {
		where += " AND tasks.pinned = ?"
		args = append(args, boolInt(*q.Pinned))
	}

	limit := q.Limit
	if limit <= 0 {
		limit = ListLimitDefault
	}
	if limit > ListLimitMax {
		return nil, Invalid("limit is at most %d.", ListLimitMax)
	}

	if term != "" {
		return s.searchTasks(ctx, principalID, where, args, term, limit)
	}

	columns, order := orderOf(q.Status)
	if q.Cursor != nil {
		if q.Cursor.Order != order || len(q.Cursor.Keys) != len(columns) {
			return nil, Invalid("That cursor belongs to a different ordering. Start the list again.")
		}
		// One row-value comparison rather than the unfolded OR chain, which is where an
		// off-by-one in the tiebreak hides.
		where += " AND (tasks." + strings.Join(columns, ", tasks.") + ", tasks.seq) < (" +
			strings.Repeat("?, ", len(columns)) + "?)"
		for _, k := range q.Cursor.Keys {
			args = append(args, k)
		}
		args = append(args, q.Cursor.Seq)
	}

	page := &TaskPage{}
	var err error
	if page.Total, err = s.countTasks(ctx, where, args); err != nil {
		return nil, err
	}

	orderBy := ""
	for _, c := range columns {
		orderBy += "tasks." + c + " DESC, "
	}
	rows, err := s.reader.QueryContext(ctx,
		`SELECT `+taskColumns+` FROM tasks WHERE `+where+
			` ORDER BY `+orderBy+`tasks.seq DESC LIMIT ?`,
		append(args, limit+1)...)
	if err != nil {
		return nil, fmt.Errorf("list tasks: %w", err)
	}
	page.Tasks, err = scanTasks(ctx, s.reader, rows)
	if err != nil {
		return nil, err
	}

	if len(page.Tasks) > limit {
		last := page.Tasks[limit-1]
		page.Tasks = page.Tasks[:limit]
		page.Next = &Cursor{Order: order, Keys: cursorKeys(columns, last), Seq: last.Seq}
	}
	return page, nil
}

// searchTasks scores every matching title in Go.
//
// Only titles are scored, and no descriptions or blobs are read: a title is a name somebody
// half-remembers and a description is prose they want a phrase out of, so the second is matched
// exactly in SQL and unioned in. Tags go the same way — a slug contains the term or it does
// not, and the box is the only place the word can be typed without knowing it is a tag.
//
// An id beats all of it. A search box is where a pasted id ends up — out of a transcript, a
// commit message, a chat — and somebody who has typed eight characters of base32 is not looking
// for a word that sounds like it. A prefix of four counts, as it does everywhere else an id is
// accepted.
func (s *Store) searchTasks(ctx context.Context, principalID, where string, args []any, term string, limit int) (*TaskPage, error) {
	// A prefix of four or more, folded the way every other id is: pasted out of prose, an id
	// arrives with its case and its punctuation. Anything that is not one leaves this empty,
	// and nothing has an empty prefix.
	named, _ := ids.NormalizeTask(strings.TrimSpace(term))

	like := "%" + escapeLike(term) + "%"
	rows, err := s.reader.QueryContext(ctx,
		`SELECT seq, id, title, pinned, description LIKE ? ESCAPE '\',
		        EXISTS (SELECT 1 FROM task_tags
		                 WHERE task_tags.task_seq = tasks.seq
		                   AND task_tags.slug LIKE ? ESCAPE '\')
		   FROM tasks WHERE `+where,
		append([]any{like, like}, args...)...)
	if err != nil {
		return nil, fmt.Errorf("search: %w", err)
	}

	type candidate struct {
		seq    int64
		score  int
		pinned bool
	}
	var found []candidate
	for rows.Next() {
		var (
			seq    int64
			id     string
			title  string
			pinned bool
			inNote bool
			inTag  bool
		)
		if err := rows.Scan(&seq, &id, &title, &pinned, &inNote, &inTag); err != nil {
			rows.Close()
			return nil, err
		}
		score, ok := search.Score(term, title)
		if named != "" && strings.HasPrefix(id, named) {
			score, ok = search.IDScore, true
		}
		if !ok && inTag {
			score, ok = search.TagScore, true
		}
		if !ok && inNote {
			score, ok = search.DescriptionScore, true
		}
		if ok {
			found = append(found, candidate{seq, score, pinned})
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Pinned first, then best first, then a stable tiebreak so equal scores do not shuffle
	// between requests.
	//
	// Pinned leads here as it does everywhere else. Ranking by score alone put a pinned task
	// below an unpinned one the moment somebody typed in the box, which reads as the pin having
	// stopped working rather than as the list having changed its question.
	sort.SliceStable(found, func(i, j int) bool {
		if found[i].pinned != found[j].pinned {
			return found[i].pinned
		}
		if found[i].score != found[j].score {
			return found[i].score > found[j].score
		}
		return found[i].seq > found[j].seq
	})
	page := &TaskPage{Total: len(found)}
	if len(found) > limit {
		found = found[:limit]
	}
	for _, c := range found {
		task, err := loadTaskBySeq(ctx, s.reader, c.seq)
		if err != nil {
			return nil, err
		}
		page.Tasks = append(page.Tasks, task)
	}
	if page.Tasks == nil {
		page.Tasks = []*Task{}
	}
	return page, nil
}

// scanTasks reads rows and attaches each task's tags.
// taskColumns is the row every read of a task selects, in the order scanTasks reads it.
const taskColumns = "seq, id, principal_id, project_id, title, description, priority, pinned, color, created_at, updated_at, poked_at, done_at, deleted_at"

// cursorKeys reads the sort values off the last row of a page, in the order they sort.
func cursorKeys(columns []string, t *Task) []int64 {
	keys := make([]int64, 0, len(columns))
	for _, c := range columns {
		switch c {
		case "pinned":
			keys = append(keys, boolInt(t.Pinned))
		case "priority":
			keys = append(keys, int64(t.Priority))
		case "poked_at":
			keys = append(keys, unix(t.PokedAt))
		case "done_at":
			if t.DoneAt != nil {
				keys = append(keys, unix(*t.DoneAt))
			} else {
				keys = append(keys, 0)
			}
		}
	}
	return keys
}

func boolInt(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

func scanTasks(ctx context.Context, q querier, rows *sql.Rows) ([]*Task, error) {
	defer rows.Close()
	out := []*Task{}
	for rows.Next() {
		var (
			t                       Task
			created, updated, poked int64
			done, deleted           sql.NullInt64
		)
		if err := rows.Scan(&t.Seq, &t.ID, &t.PrincipalID, &t.ProjectID, &t.Title, &t.Description,
			&t.Priority, &t.Pinned, &t.Color, &created, &updated, &poked, &done, &deleted); err != nil {
			return nil, fmt.Errorf("list tasks: %w", err)
		}
		t.CreatedAt = time.Unix(created, 0).UTC()
		t.UpdatedAt = time.Unix(updated, 0).UTC()
		t.PokedAt = time.Unix(poked, 0).UTC()
		if done.Valid {
			at := time.Unix(done.Int64, 0).UTC()
			t.DoneAt = &at
		}
		if deleted.Valid {
			at := time.Unix(deleted.Int64, 0).UTC()
			t.DeletedAt = &at
		}
		out = append(out, &t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, t := range out {
		tags, err := loadTags(ctx, q, t.Seq)
		if err != nil {
			return nil, err
		}
		t.Tags = tags
	}
	return out, nil
}

func (s *Store) countTasks(ctx context.Context, where string, args []any) (int, error) {
	var n int
	err := s.reader.QueryRowContext(ctx, `SELECT count(*) FROM tasks WHERE `+where, args...).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("count tasks: %w", err)
	}
	return n, nil
}

func loadTaskBySeq(ctx context.Context, q querier, seq int64) (*Task, error) {
	var (
		t                       Task
		created, updated, poked int64
		done, deleted           any
	)
	err := q.QueryRowContext(ctx,
		`SELECT `+taskColumns+` FROM tasks WHERE seq = ?`, seq).
		Scan(&t.Seq, &t.ID, &t.PrincipalID, &t.ProjectID, &t.Title, &t.Description,
			&t.Priority, &t.Pinned, &t.Color, &created, &updated, &poked, &done, &deleted)
	if err != nil {
		return nil, fmt.Errorf("task: %w", err)
	}
	t.CreatedAt = time.Unix(created, 0).UTC()
	t.UpdatedAt = time.Unix(updated, 0).UTC()
	t.PokedAt = time.Unix(poked, 0).UTC()
	if v, ok := done.(int64); ok {
		at := time.Unix(v, 0).UTC()
		t.DoneAt = &at
	}
	if v, ok := deleted.(int64); ok {
		at := time.Unix(v, 0).UTC()
		t.DeletedAt = &at
	}
	t.Tags, err = loadTags(ctx, q, t.Seq)
	return &t, err
}

func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}
