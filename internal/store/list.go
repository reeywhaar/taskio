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
	return []string{"pinned", "priority", "created_at"}, "live"
}

// ListTasks answers a query.
//
// Without a search term this is one page of rows and one count. With one, every matching title
// is scored in Go and the page is the best of them — which turns pagination off, because a
// score is neither in the table nor stable when a task is edited.
func (s *Store) ListTasks(ctx context.Context, principalID string, scope *filter.Node, q TaskQuery, term string) (*TaskPage, error) {
	where, args := scopeClause(principalID, scope)
	if q.Filter != nil {
		sql, fargs := filter.Compile(q.Filter, "tasks.seq")
		where += " AND " + sql
		args = append(args, fargs...)
	}
	switch q.Status {
	case StatusTodo, "":
		where += " AND tasks.done_at IS NULL"
	case StatusDone:
		where += " AND tasks.done_at IS NOT NULL"
	case StatusAll:
	default:
		return nil, Invalid("status is todo, done or all.")
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
// Titles only, and no descriptions or blobs are read: a title is a name somebody half-remembers
// and a description is prose they want a phrase out of, so the second is matched exactly in SQL
// and unioned in.
func (s *Store) searchTasks(ctx context.Context, principalID, where string, args []any, term string, limit int) (*TaskPage, error) {
	rows, err := s.reader.QueryContext(ctx,
		`SELECT seq, title, description LIKE ? ESCAPE '\' FROM tasks WHERE `+where,
		append([]any{"%" + escapeLike(term) + "%"}, args...)...)
	if err != nil {
		return nil, fmt.Errorf("search: %w", err)
	}

	type candidate struct {
		seq   int64
		score int
	}
	var found []candidate
	for rows.Next() {
		var (
			seq    int64
			title  string
			inNote bool
		)
		if err := rows.Scan(&seq, &title, &inNote); err != nil {
			rows.Close()
			return nil, err
		}
		score, ok := search.Score(term, title)
		if !ok && inNote {
			score, ok = search.DescriptionScore, true
		}
		if ok {
			found = append(found, candidate{seq, score})
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Best first, and a stable tiebreak so equal scores do not shuffle between requests.
	sort.SliceStable(found, func(i, j int) bool {
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
const taskColumns = "seq, id, principal_id, title, description, priority, pinned, created_at, updated_at, done_at"

// cursorKeys reads the sort values off the last row of a page, in the order they sort.
func cursorKeys(columns []string, t *Task) []int64 {
	keys := make([]int64, 0, len(columns))
	for _, c := range columns {
		switch c {
		case "pinned":
			keys = append(keys, boolInt(t.Pinned))
		case "priority":
			keys = append(keys, int64(t.Priority))
		case "created_at":
			keys = append(keys, unix(t.CreatedAt))
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
			t                Task
			created, updated int64
			done             sql.NullInt64
		)
		if err := rows.Scan(&t.Seq, &t.ID, &t.PrincipalID, &t.Title, &t.Description,
			&t.Priority, &t.Pinned, &created, &updated, &done); err != nil {
			return nil, fmt.Errorf("list tasks: %w", err)
		}
		t.CreatedAt = time.Unix(created, 0).UTC()
		t.UpdatedAt = time.Unix(updated, 0).UTC()
		if done.Valid {
			at := time.Unix(done.Int64, 0).UTC()
			t.DoneAt = &at
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
		t                Task
		created, updated int64
		done             any
	)
	err := q.QueryRowContext(ctx,
		`SELECT seq, id, principal_id, title, description, priority, pinned, created_at, updated_at, done_at
		   FROM tasks WHERE seq = ?`, seq).
		Scan(&t.Seq, &t.ID, &t.PrincipalID, &t.Title, &t.Description,
			&t.Priority, &t.Pinned, &created, &updated, &done)
	if err != nil {
		return nil, fmt.Errorf("task: %w", err)
	}
	t.CreatedAt = time.Unix(created, 0).UTC()
	t.UpdatedAt = time.Unix(updated, 0).UTC()
	if v, ok := done.(int64); ok {
		at := time.Unix(v, 0).UTC()
		t.DoneAt = &at
	}
	t.Tags, err = loadTags(ctx, q, t.Seq)
	return &t, err
}

func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}
