package api

import (
	"net/http"

	"taskio/internal/store"
)

// listTags answers with what the caller's tasks actually carry.
func (s *Server) listTags(w http.ResponseWriter, r *http.Request) {
	project, ok := s.projectOf(w, r)
	if !ok {
		return
	}
	tags, err := s.store.Tags(r.Context(), principalOf(r).ID, project.ID, reachOf(r).Scope(project.ID))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	out := make([]map[string]string, 0, len(tags))
	for _, tag := range tags {
		out = append(out, map[string]string{"id": tag.ID, "slug": tag.Slug})
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": out})
}

type tagOrderRequest struct {
	Slugs []string `json:"slugs"`
}

// setTagOrder records where the cloud's pills have been dragged to.
//
// Session-only, like groups: it is an arrangement of somebody's screen rather than something a
// program needs to work the list, and a scoped token naming every slug on the account is a
// scoped token learning the words it cannot see.
func (s *Server) setTagOrder(w http.ResponseWriter, r *http.Request) {
	var req tagOrderRequest
	if !decode(w, r, &req) {
		return
	}
	project, ok := s.projectOf(w, r)
	if !ok {
		return
	}
	if err := s.store.SetTagOrder(r.Context(), principalOf(r).ID, project.ID, req.Slugs); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type renameTagRequest struct {
	Slug string `json:"slug"`
}

// renameTag moves a slug across every task the caller can reach.
//
// Renaming onto one already in use is a merge rather than a conflict: the alternative tells
// somebody that what they asked for has already partly happened, which is a refusal nobody can
// act on.
func (s *Server) renameTag(w http.ResponseWriter, r *http.Request) {
	var req renameTagRequest
	if !decode(w, r, &req) {
		return
	}
	from := store.NormalizeSlug(r.PathValue("slug"))
	project, ok := s.projectOf(w, r)
	if !ok {
		return
	}
	if err := s.guardScopeTag(w, r, project.ID, from); err != nil {
		return
	}
	n, err := s.store.RenameTag(r.Context(), principalOf(r).ID, project.ID, reachOf(r).Scope(project.ID), from, req.Slug)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"slug": store.NormalizeSlug(req.Slug), "tasks": n})
}

// removeTag takes a slug off every task the caller can reach.
//
// Not a delete of anything: the tag stops existing because nothing says it any more.
func (s *Server) removeTag(w http.ResponseWriter, r *http.Request) {
	slug := store.NormalizeSlug(r.PathValue("slug"))
	project, ok := s.projectOf(w, r)
	if !ok {
		return
	}
	if err := s.guardScopeTag(w, r, project.ID, slug); err != nil {
		return
	}
	n, err := s.store.RemoveTag(r.Context(), principalOf(r).ID, project.ID, reachOf(r).Scope(project.ID), slug)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": n})
}

// guardScopeTag refuses a token renaming or removing a slug its own scope names.
//
// It would rename it on exactly the tasks it can see, which are then the tasks it can no longer
// see: the credential would empty its own view in one request. Same rule as everywhere else —
// a write may not take a task out of the writer's reach.
func (s *Server) guardScopeTag(w http.ResponseWriter, r *http.Request, projectID, slug string) error {
	for _, scoped := range reachOf(r).Requires(projectID) {
		if scoped == slug {
			refuse(w, http.StatusForbidden, CodeOutOfScope,
				"This token is scoped to "+slug+", so it cannot rename or remove that tag.")
			return errOutOfScope
		}
	}
	return nil
}
