package api

import (
	"net/http"

	"taskio/internal/store"
)

type groupBody struct {
	ID   string   `json:"id"`
	Name string   `json:"name"`
	Tags []string `json:"tags"`
	// Empty for the brand colour, which is what a group without one wears.
	Color     string `json:"color"`
	CreatedAt int64  `json:"created_at"`
}

func renderGroup(g *store.Group) groupBody {
	return groupBody{
		ID:        g.ID,
		Name:      g.Name,
		Tags:      g.Tags,
		Color:     g.Color,
		CreatedAt: g.CreatedAt.Unix(),
	}
}

// Groups are session-only, like tokens and sessions.
//
// Not because a program could not use one, but because a scoped token must not learn tag names
// its scope does not reach — and a group is a list of tag names. /docs is what an agent needs
// to work the list, and a saved filter is not part of working it.
func (s *Server) listGroups(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.Groups(r.Context(), principalOf(r).ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	out := make([]groupBody, 0, len(list))
	for _, g := range list {
		out = append(out, renderGroup(g))
	}
	writeJSON(w, http.StatusOK, map[string]any{"groups": out})
}

type groupRequest struct {
	Name  string   `json:"name"`
	Tags  []string `json:"tags"`
	Color string   `json:"color"`
}

func (s *Server) createGroup(w http.ResponseWriter, r *http.Request) {
	var req groupRequest
	if !decode(w, r, &req) {
		return
	}
	g, err := s.store.CreateGroup(r.Context(), principalOf(r).ID, req.Name, req.Tags, req.Color)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, renderGroup(g))
}

// patchGroup replaces both fields, since the dialog that edits one edits both.
func (s *Server) patchGroup(w http.ResponseWriter, r *http.Request) {
	var req groupRequest
	if !decode(w, r, &req) {
		return
	}
	g, err := s.store.UpdateGroup(r.Context(), principalOf(r).ID, r.PathValue("id"), req.Name, req.Tags, req.Color)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, renderGroup(g))
}

type groupOrderRequest struct {
	IDs []string `json:"ids"`
}

// putGroupOrder records where the rail's groups have been dragged to.
func (s *Server) putGroupOrder(w http.ResponseWriter, r *http.Request) {
	var req groupOrderRequest
	if !decode(w, r, &req) {
		return
	}
	if err := s.store.SetGroupOrder(r.Context(), principalOf(r).ID, req.IDs); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteGroup(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteGroup(r.Context(), principalOf(r).ID, r.PathValue("id")); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
