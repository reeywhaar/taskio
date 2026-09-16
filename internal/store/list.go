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
type Cursor struct {
	Order string
	Key   int64
	Seq   int64
}

func (c *Cursor) String() string {
	return base64.RawURLEncoding.EncodeToString(
		[]byte(c.Order + "." + strconv.FormatInt(c.Key, 10) + "." + strconv.FormatInt(c.Seq, 10)))
}

// ParseCursor reads one back. Opaque by contract, so anything that does not decode is refused.
func ParseCursor(s string) (*Cursor, error) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, Invalid("That cursor is not one this gave out.")
	}
	parts := strings.Split(string(raw), ".")
	if len(parts) != 3 {
		return nil, Invalid("That cursor is not one this gave out.")
	}
	key, err1 := strconv.ParseInt(parts[1], 10, 64)
	seq, err2 := strconv.ParseInt(parts[2], 10, 64)
	if err1 != nil || err2 != nil {
		return nil, Invalid("That cursor is not one this gave out.")
	}
	return &Cursor{Order: parts[0], Key: key, Seq: seq}, nil
}

// TaskPage is what a list answers with.
type TaskPage struct {
	Tasks []*Task
	Total int
	Next  *Cursor
}

// orderOf is which key a status sorts by.
//
// A finished list is a record of what happened, so the useful order is the order things were
// finished: a task written in March and done yesterday belongs at the top.
func orderOf(status string) (column, name string) {
	if status == StatusDone {
		return "done_at", "done"
	}
	return "created_at", "live"
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

	column, order := orderOf(q.Status)
	if q.Cursor != nil {
		if q.Cursor.Order != order {
			return nil, Invalid("That cursor belongs to a different ordering. Start the list again.")
		}
		where += fmt.Sprintf(" AND (tasks.%s, tasks.seq) < (?, ?)", column)
		args = append(args, q.Cursor.Key, q.Cursor.Seq)
	}

	page := &TaskPage{}
	var err error
	if page.Total, err = s.countTasks(ctx, where, args); err != nil {
		return nil, err
	}

	rows, err := s.reader.QueryContext(ctx,
		`SELECT seq, id, principal_id, title, description, created_at, updated_at, done_at
		   FROM tasks WHERE `+where+
			fmt.Sprintf(` ORDER BY tasks.%s DESC, tasks.seq DESC LIMIT ?`, column),
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
		key := last.CreatedAt
		if order == "done" && last.DoneAt != nil {
			key = *last.DoneAt
		}
		page.Next = &Cursor{Order: order, Key: unix(key), Seq: last.Seq}
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
			&created, &updated, &done); err != nil {
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
		`SELECT seq, id, principal_id, title, description, created_at, updated_at, done_at
		   FROM tasks WHERE seq = ?`, seq).
		Scan(&t.Seq, &t.ID, &t.PrincipalID, &t.Title, &t.Description, &created, &updated, &done)
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
