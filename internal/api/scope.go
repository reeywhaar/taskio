package api

import (
	"errors"
	"net/http"
	"slices"
	"strings"

	"taskio/internal/filter"
	"taskio/internal/store"
)

// errOutOfScope is a credential reaching past its own scope, which is a 403 rather than a 404.
var errOutOfScope = errors.New("out of scope")

// scopeOf is the filter confining this request, or nil for a session.
func scopeOf(r *http.Request) *filter.Node {
	n, _ := r.Context().Value(ctxScope).(*filter.Node)
	return n
}

// scopeTags is the slugs a scope names: the tags everything a scoped token writes must carry.
func scopeTags(r *http.Request) []string {
	return filter.Slugs(scopeOf(r))
}

// missingScopeTags is which of the scope's tags a write left out.
//
// Asked for rather than added. A token used to put its tags on whatever it wrote and quietly
// keep them through an edit that dropped them, so an agent never learned what its credential
// required — and a task came back carrying tags nobody sent. Now it is told, and GET /api/scope
// says the same thing before it has to be told.
func missingScopeTags(r *http.Request, tags []string) []string {
	var missing []string
	for _, slug := range scopeTags(r) {
		if !slices.Contains(tags, slug) {
			missing = append(missing, slug)
		}
	}
	return missing
}

// refuseMissingTags says which tags, and where the full answer is.
func refuseMissingTags(w http.ResponseWriter, missing []string) {
	them := "them"
	if len(missing) == 1 {
		them = "it"
	}
	refuse(w, http.StatusBadRequest, CodeScopeTagsMissing,
		"This token writes only tasks tagged "+strings.Join(missing, " and ")+
			". Put "+them+" in tags; GET /api/scope lists what it requires.")
}

// getScope is what this credential reaches and what everything it writes must carry, so an
// agent can ask instead of finding out from a refusal. A session is unscoped.
func (s *Server) getScope(w http.ResponseWriter, r *http.Request) {
	scope := ""
	if n := scopeOf(r); n != nil {
		scope = filter.Print(n)
	}
	requires := scopeTags(r)
	if requires == nil {
		requires = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"scope": scope, "requires": requires})
}

// matchesScope reports whether a task carries every slug the scope names.
func matchesScope(task *store.Task, scope *filter.Node) bool {
	have := map[string]bool{}
	for _, slug := range task.Tags {
		have[slug] = true
	}
	for _, slug := range filter.Slugs(scope) {
		if !have[slug] {
			return false
		}
	}
	return true
}
