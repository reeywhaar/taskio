package api

import (
	"errors"
	"net/http"
	"sort"
	"strings"

	"taskio/internal/filter"
	"taskio/internal/store"
)

// errOutOfScope is a credential reaching past its own scope, which is a 403 rather than a 404.
var errOutOfScope = errors.New("out of scope")

// reachOf is what this request may touch: for a token, each project it reaches with the scope
// confining it there; for a session, nil — everything the account has.
func reachOf(r *http.Request) store.Reach {
	reach, _ := r.Context().Value(ctxReach).(store.Reach)
	return reach
}

// projectOf is the project a request is about.
//
// Named with ?project=, or left out, which means: for a session, the default project; for a
// token reaching one project, that one — so every token minted before projects existed keeps
// working unchanged. A token reaching several has no default, and is told to say which, with
// their slugs, rather than having one picked for it.
//
// A deleted project is answered as deleted, not as missing: a token still naming one is owed
// the reason it stopped working.
func (s *Server) projectOf(w http.ResponseWriter, r *http.Request) (*store.Project, bool) {
	ctx := r.Context()
	principal := principalOf(r).ID
	reach := reachOf(r)
	slug := strings.TrimSpace(r.URL.Query().Get("project"))

	var p *store.Project
	var err error
	switch {
	case slug != "":
		p, err = s.store.ProjectBySlug(ctx, principal, slug)
	case reach == nil:
		p, err = s.store.DefaultProject(ctx, principal)
	case len(reach) == 1:
		for id := range reach {
			p, err = s.store.ProjectByID(ctx, principal, id)
		}
		if err == nil && p.DeletedAt != nil {
			err = store.Gone("Project %s was deleted.", p.Slug)
		}
	default:
		slugs, err := s.reachedSlugs(r)
		if err != nil {
			s.fail(w, r, err)
			return nil, false
		}
		refuse(w, http.StatusBadRequest, CodeProjectRequired,
			"This token reaches several projects: "+strings.Join(slugs, ", ")+
				". Say which with ?project=; GET /api/scope lists them.")
		return nil, false
	}
	if err != nil {
		s.fail(w, r, err)
		return nil, false
	}
	if !reach.Reaches(p.ID) {
		refuse(w, http.StatusForbidden, CodeOutOfScope, "This token does not reach project "+p.Slug+".")
		return nil, false
	}
	return p, true
}

// namedProject is a project named in a body rather than the URL — where a task is moving to.
// It has to be one this caller reaches.
func (s *Server) namedProject(w http.ResponseWriter, r *http.Request, slug string) (*store.Project, bool) {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		refuse(w, http.StatusBadRequest, CodeInvalid, "Say which project, by its slug.")
		return nil, false
	}
	p, err := s.store.ProjectBySlug(r.Context(), principalOf(r).ID, slug)
	if err != nil {
		s.fail(w, r, err)
		return nil, false
	}
	if !reachOf(r).Reaches(p.ID) {
		refuse(w, http.StatusForbidden, CodeOutOfScope, "This token does not reach project "+p.Slug+".")
		return nil, false
	}
	return p, true
}

// reachedSlugs is the live projects a token reaches, by slug, for a sentence about them.
func (s *Server) reachedSlugs(r *http.Request) ([]string, error) {
	projects, err := s.store.Projects(r.Context(), principalOf(r).ID)
	if err != nil {
		return nil, err
	}
	reach := reachOf(r)
	var out []string
	for _, p := range projects {
		if reach.Reaches(p.ID) {
			out = append(out, p.Slug)
		}
	}
	return out, nil
}

// projectSlugs names every live project of the account by id, for rendering a task's project.
func (s *Server) projectSlugs(r *http.Request) (map[string]string, error) {
	projects, err := s.store.Projects(r.Context(), principalOf(r).ID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(projects))
	for _, p := range projects {
		out[p.ID] = p.Slug
	}
	return out, nil
}

// scopeEntry is one project in what GET /api/scope answers.
type scopeEntry struct {
	Slug    string `json:"slug"`
	Name    string `json:"name"`
	Default bool   `json:"default"`
	// Scope is the filter confining the token here, or empty for all of it.
	Scope string `json:"scope"`
	// Requires is the tags a task written here has to carry, and Match whether it needs "all"
	// of them or "any" one. Both empty when it needs none.
	Requires []string `json:"requires"`
	Match    string   `json:"match"`
	// Deleted is a project the token still names and that no longer exists. Asking for it is
	// answered 410.
	Deleted bool `json:"deleted,omitempty"`
}

// getScope is what this credential reaches and what everything it writes must carry, project
// by project, so an agent can ask instead of finding out from a refusal. A session reaches
// every project, confined in none.
func (s *Server) getScope(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	principal := principalOf(r).ID
	reach := reachOf(r)

	projects, err := s.store.Projects(ctx, principal)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	seen := map[string]bool{}
	out := []scopeEntry{}
	add := func(p *store.Project) {
		seen[p.ID] = true
		e := scopeEntry{Slug: p.Slug, Name: p.Name, Default: p.Default, Requires: []string{},
			Deleted: p.DeletedAt != nil}
		if scope := reach.Scope(p.ID); scope != nil {
			e.Scope = filter.Print(scope)
			e.Requires = filter.Slugs(scope)
			e.Match = "all"
			if scope.Op == filter.Or {
				e.Match = "any"
			}
		}
		out = append(out, e)
	}
	for _, p := range projects {
		if reach.Reaches(p.ID) {
			add(p)
		}
	}
	// A token's rows can name projects since deleted, which the live listing does not have.
	var gone []string
	for id := range reach {
		if !seen[id] {
			gone = append(gone, id)
		}
	}
	sort.Strings(gone)
	for _, id := range gone {
		if p, err := s.store.ProjectByID(ctx, principal, id); err == nil {
			add(p)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": out})
}
