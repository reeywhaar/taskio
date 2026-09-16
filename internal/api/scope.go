package api

import (
	"errors"
	"net/http"

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

// scopeTags is the slugs a scoped token applies to everything it writes.
//
// Only an unnested and() of slugs has an answer to "create it with these tags", which is why a
// scope is that shape and nothing else.
func scopeTags(r *http.Request) []string {
	return filter.Slugs(scopeOf(r))
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
