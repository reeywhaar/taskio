package api

import (
	"net/http"

	"taskio/internal/store"
)

// projectBody is one project as the browser sees it.
type projectBody struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Slug      string `json:"slug"`
	Default   bool   `json:"default"`
	CreatedAt int64  `json:"created_at"`
}

func renderProject(p *store.Project) projectBody {
	return projectBody{ID: p.ID, Name: p.Name, Slug: p.Slug, Default: p.Default, CreatedAt: p.CreatedAt.Unix()}
}

// listProjects is the rail: every live project, in the order it was dragged into.
func (s *Server) listProjects(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.Projects(r.Context(), principalOf(r).ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	out := make([]projectBody, 0, len(list))
	for _, p := range list {
		out = append(out, renderProject(p))
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": out})
}

type projectRequest struct {
	Name *string `json:"name"`
	// Slug is derived from the name when a project is made without one, and changes only when
	// it is sent: a rename keeps every link that named the project working.
	Slug *string `json:"slug"`
}

func (s *Server) createProject(w http.ResponseWriter, r *http.Request) {
	var req projectRequest
	if !decode(w, r, &req) {
		return
	}
	name, slug := "", ""
	if req.Name != nil {
		name = *req.Name
	}
	if req.Slug != nil {
		slug = *req.Slug
	}
	p, err := s.store.CreateProject(r.Context(), principalOf(r).ID, name, slug)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, renderProject(p))
}

func (s *Server) patchProject(w http.ResponseWriter, r *http.Request) {
	var req projectRequest
	if !decode(w, r, &req) {
		return
	}
	p, err := s.store.UpdateProject(r.Context(), principalOf(r).ID, r.PathValue("id"), req.Name, req.Slug)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, renderProject(p))
}

type projectOrderRequest struct {
	IDs []string `json:"ids"`
}

func (s *Server) putProjectOrder(w http.ResponseWriter, r *http.Request) {
	var req projectOrderRequest
	if !decode(w, r, &req) {
		return
	}
	if err := s.store.SetProjectOrder(r.Context(), principalOf(r).ID, req.IDs); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// deleteProject deletes it and every task, group and tag arrangement in it. The name typed into
// the confirmation is the browser's business; this is the session's own route, and a token can
// never reach it.
func (s *Server) deleteProject(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteProject(r.Context(), principalOf(r).ID, r.PathValue("id")); err != nil {
		s.fail(w, r, err)
		return
	}
	s.log.Info("project deleted", "principal", principalOf(r).ID, "project", r.PathValue("id"))
	w.WriteHeader(http.StatusNoContent)
}
