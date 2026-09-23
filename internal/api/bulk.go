package api

import (
	"net/http"
	"slices"

	"taskio/internal/store"
)

type bulkRequest struct {
	IDs []string `json:"ids"`
}

type bulkTagsRequest struct {
	IDs    []string `json:"ids"`
	Add    []string `json:"add"`
	Remove []string `json:"remove"`
}

// Four routes rather than one with an op field, so each has its own request struct and its own
// validation, and a reader of the route table can see what bulk mode can do.
func (s *Server) bulkDone(done bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req bulkRequest
		if !decode(w, r, &req) {
			return
		}
		if err := s.store.BulkDone(r.Context(), principalOf(r).ID, scopeOf(r), req.IDs, done); err != nil {
			s.fail(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *Server) bulkTags(w http.ResponseWriter, r *http.Request) {
	var req bulkTagsRequest
	if !decode(w, r, &req) {
		return
	}
	// Removing a tag the scope names is dropping it from every task in the set.
	for _, slug := range scopeTags(r) {
		if slices.Contains(req.Remove, slug) {
			refuseMissingTags(w, []string{slug})
			return
		}
	}
	err := s.store.BulkTagChange(r.Context(), principalOf(r).ID, scopeOf(r), req.IDs,
		store.BulkTags{Add: req.Add, Remove: req.Remove})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type bulkPriorityRequest struct {
	IDs      []string `json:"ids"`
	Priority int      `json:"priority"`
}

func (s *Server) bulkPriority(w http.ResponseWriter, r *http.Request) {
	var req bulkPriorityRequest
	if !decode(w, r, &req) {
		return
	}
	if err := s.store.BulkPriority(r.Context(), principalOf(r).ID, scopeOf(r), req.IDs, req.Priority); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type bulkPinnedRequest struct {
	IDs    []string `json:"ids"`
	Pinned bool     `json:"pinned"`
}

func (s *Server) bulkPinned(w http.ResponseWriter, r *http.Request) {
	var req bulkPinnedRequest
	if !decode(w, r, &req) {
		return
	}
	if err := s.store.BulkPinned(r.Context(), principalOf(r).ID, scopeOf(r), req.IDs, req.Pinned); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// bulkDelete is a POST rather than a DELETE with a body: a body on DELETE is legal and is
// dropped by enough intermediaries and client libraries that it is not worth being right about.
func (s *Server) bulkDelete(w http.ResponseWriter, r *http.Request) {
	var req bulkRequest
	if !decode(w, r, &req) {
		return
	}
	if err := s.store.BulkDelete(r.Context(), principalOf(r).ID, scopeOf(r), req.IDs); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
