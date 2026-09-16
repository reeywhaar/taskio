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
	CreatedAt   int64    `json:"created_at"`
	UpdatedAt   int64    `json:"updated_at"`
	DoneAt      *int64   `json:"done_at"`
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
		// Refused rather than treated as matching nothing: a typo would otherwise be
		// indistinguishable from an empty result, and the caller most likely to make one is a
		// model that will conclude the list is empty and act on it.
		unknown, err := s.store.UnknownSlugs(r.Context(), principalOf(r).ID, scopeOf(r), filter.Slugs(parsed))
		if err != nil {
			s.fail(w, r, err)
			return
		}
		if len(unknown) > 0 {
			refuse(w, http.StatusBadRequest, CodeTagUnknown, unknownSentence(unknown))
			return
		}
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
}

// createTask writes one. An unknown slug is accepted: writing a word onto a task is how a tag
// comes into existence, and there is no create-a-tag call to make first.
func (s *Server) createTask(w http.ResponseWriter, r *http.Request) {
	var req createTaskRequest
	if !decode(w, r, &req) {
		return
	}
	// A scoped token's tags are applied on top of whatever was asked for, so a create with no
	// tags at all still comes back tagged and cannot fail on scope.
	tags := append(scopeTags(r), req.Tags...)

	task, err := s.store.CreateTask(r.Context(), principalOf(r).ID, scopeTags(r), store.TaskNew{
		Title:       req.Title,
		Description: req.Description,
		Tags:        tags,
		Priority:    req.Priority,
		Pinned:      req.Pinned,
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
	if req.Tags != nil {
		// The scope's tags are applied to the result, so a scoped token cannot push a task out
		// of its own reach.
		merged := append(scopeTags(r), *req.Tags...)
		req.Tags = &merged
	}

	updated, err := s.store.UpdateTask(r.Context(), principalOf(r).ID, scopeTags(r), task.ID, store.TaskPatch{
		Title:       req.Title,
		Description: req.Description,
		Tags:        req.Tags,
		Priority:    req.Priority,
		Pinned:      req.Pinned,
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

func unknownSentence(unknown []string) string {
	if len(unknown) == 1 {
		return "No task carries the tag " + strconv.Quote(unknown[0]) + "."
	}
	out := "No task carries these tags: "
	for i, slug := range unknown {
		if i > 0 {
			out += ", "
		}
		out += strconv.Quote(slug)
	}
	return out + "."
}
