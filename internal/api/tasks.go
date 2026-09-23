package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"taskio/internal/filter"
	"taskio/internal/store"
)

// taskBody is one task as everything outside sees it.
type taskBody struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	Status      string   `json:"status"`
	Priority    int      `json:"priority"`
	Pinned      bool     `json:"pinned"`
	Color       string   `json:"color"`
	CreatedAt   int64    `json:"created_at"`
	UpdatedAt   int64    `json:"updated_at"`
	DoneAt      *int64   `json:"done_at"`
	DeletedAt   *int64   `json:"deleted_at"`
}

func renderTask(t *store.Task) taskBody {
	body := taskBody{
		ID:          t.ID,
		Title:       t.Title,
		Description: t.Description,
		Tags:        t.Tags,
		Status:      t.Status(),
		Priority:    t.Priority,
		Pinned:      t.Pinned,
		Color:       t.Color,
		CreatedAt:   t.CreatedAt.Unix(),
		UpdatedAt:   t.UpdatedAt.Unix(),
	}
	if body.Tags == nil {
		body.Tags = []string{}
	}
	if t.DoneAt != nil {
		at := t.DoneAt.Unix()
		body.DoneAt = &at
	}
	if t.DeletedAt != nil {
		at := t.DeletedAt.Unix()
		body.DeletedAt = &at
	}
	return body
}

func (s *Server) listTasks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	var parsed *filter.Node
	if raw := q.Get("tags"); raw != "" {
		var err error
		if parsed, err = filter.Parse(raw); err != nil {
			refuse(w, http.StatusBadRequest, CodeFilterInvalid, err.Error())
			return
		}
		// A slug nothing carries matches nothing, and that is the whole of it. This used to be
		// a refusal, on the grounds that a typo is indistinguishable from an empty result —
		// but an empty result is a true answer to the question that was asked, and the rule
		// cost more than it caught: a filter naming a tag whose last task has been deleted
		// stopped working without the caller changing anything, not() of a word that does not
		// exist excludes nothing and was refused anyway, and a group naming a tag its tasks
		// have not been written yet could not be opened at all.
	}

	query := store.TaskQuery{Filter: parsed, Status: q.Get("status")}
	// A property rather than a status: a pinned task is still a todo, and the two questions
	// compose — pinned=true&status=done is the pinned things already finished.
	if raw := q.Get("pinned"); raw != "" {
		want, err := strconv.ParseBool(raw)
		if err != nil {
			refuse(w, http.StatusBadRequest, CodeInvalid, "pinned is true or false.")
			return
		}
		query.Pinned = &want
	}
	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			refuse(w, http.StatusBadRequest, CodeInvalid, "limit is a number from 1 to "+strconv.Itoa(store.ListLimitMax)+".")
			return
		}
		query.Limit = n
	}
	if raw := q.Get("cursor"); raw != "" {
		c, err := store.ParseCursor(raw)
		if err != nil {
			refuse(w, http.StatusBadRequest, CodeCursorInvalid, sentence(err, "That cursor is not one this gave out."))
			return
		}
		query.Cursor = c
	}

	page, err := s.store.ListTasks(r.Context(), principalOf(r).ID, scopeOf(r), query, q.Get("q"))
	if err != nil {
		s.fail(w, r, err)
		return
	}

	out := map[string]any{"tasks": renderTasks(page.Tasks), "total": page.Total}
	if page.Next != nil {
		out["next_cursor"] = page.Next.String()
	}
	writeJSON(w, http.StatusOK, out)
}

func renderTasks(list []*store.Task) []taskBody {
	out := make([]taskBody, 0, len(list))
	for _, t := range list {
		out = append(out, renderTask(t))
	}
	return out
}

type createTaskRequest struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	Priority    int      `json:"priority"`
	Pinned      bool     `json:"pinned"`
	Color       string   `json:"color"`
}

// createTask writes one. An unknown slug is accepted: writing a word onto a task is how a tag
// comes into existence, and there is no create-a-tag call to make first.
func (s *Server) createTask(w http.ResponseWriter, r *http.Request) {
	var req createTaskRequest
	if !decode(w, r, &req) {
		return
	}
	// A scoped token names its tags itself. See missingScopeTags.
	if missing := missingScopeTags(r, req.Tags); len(missing) > 0 {
		refuseMissingTags(w, missing)
		return
	}

	task, err := s.store.CreateTask(r.Context(), principalOf(r).ID, scopeTags(r), store.TaskNew{
		Title:       req.Title,
		Description: req.Description,
		Tags:        req.Tags,
		Priority:    req.Priority,
		Pinned:      req.Pinned,
		Color:       req.Color,
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, renderTask(task))
}

// getTask carries the mentions with it, so a client draws a chip with a title on it and a model
// follows one without a request per id.
func (s *Server) getTask(w http.ResponseWriter, r *http.Request) {
	task, err := s.task(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	mentions, err := s.store.TaskMentions(r.Context(), principalOf(r).ID, task.Seq)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	body := map[string]any{}
	for k, v := range asMap(renderTask(task)) {
		body[k] = v
	}
	body["mentions"] = renderStubs(mentions.Mentions, scopeOf(r))
	body["mentioned_by"] = renderStubs(mentions.MentionedBy, scopeOf(r))
	writeJSON(w, http.StatusOK, body)
}

// taskStub is a mention: enough to draw a link with a title on it.
type taskStub struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

// renderStubs filters to the scope, on the same reasoning as everything else: what refers to a
// task is not something a confined credential learns for free.
func renderStubs(list []*store.Task, scope *filter.Node) []taskStub {
	out := []taskStub{}
	for _, t := range list {
		if scope != nil && !matchesScope(t, scope) {
			continue
		}
		out = append(out, taskStub{ID: t.ID, Title: t.Title, Status: t.Status()})
	}
	return out
}

func asMap(body taskBody) map[string]any {
	raw, _ := json.Marshal(body)
	var out map[string]any
	json.Unmarshal(raw, &out)
	return out
}

type patchTaskRequest struct {
	Title       *string   `json:"title"`
	Description *string   `json:"description"`
	Tags        *[]string `json:"tags"`
	Priority    *int      `json:"priority"`
	Pinned      *bool     `json:"pinned"`
	Color       *string   `json:"color"`
}

// patchTask changes wording and tags. Absent leaves a field alone and empty clears it.
func (s *Server) patchTask(w http.ResponseWriter, r *http.Request) {
	var req patchTaskRequest
	if !decode(w, r, &req) {
		return
	}
	task, err := s.task(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	// Only when the edit sets the tags at all: a PATCH that leaves them out does not touch
	// them, so there is nothing for it to have dropped.
	if req.Tags != nil {
		if missing := missingScopeTags(r, *req.Tags); len(missing) > 0 {
			refuseMissingTags(w, missing)
			return
		}
	}

	updated, err := s.store.UpdateTask(r.Context(), principalOf(r).ID, scopeTags(r), task.ID, store.TaskPatch{
		Title:       req.Title,
		Description: req.Description,
		Tags:        req.Tags,
		Priority:    req.Priority,
		Pinned:      req.Pinned,
		Color:       req.Color,
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, renderTask(updated))
}

func (s *Server) setDone(done bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		task, err := s.task(r)
		if err != nil {
			s.fail(w, r, err)
			return
		}
		updated, err := s.store.SetDone(r.Context(), principalOf(r).ID, task.ID, done)
		if err != nil {
			s.fail(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, renderTask(updated))
	}
}

func (s *Server) deleteTask(w http.ResponseWriter, r *http.Request) {
	task, err := s.task(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.store.DeleteTask(r.Context(), principalOf(r).ID, task.ID); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// task resolves the {id} path value, which may be a whole id or an unambiguous prefix.
//
// Scoped, so a task the caller cannot see is not found rather than refused, and a prefix
// ambiguous only because of somebody else's task is not ambiguous here.
func (s *Server) task(r *http.Request) (*store.Task, error) {
	task, err := s.store.Task(r.Context(), principalOf(r).ID, r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	if scope := scopeOf(r); scope != nil && !matchesScope(task, scope) {
		// Authenticated, and the task is theirs; what is refused is this credential's reach. A
		// 404 would have an agent conclude the task is gone and act on it.
		return nil, errOutOfScope
	}
	return task, nil
}
