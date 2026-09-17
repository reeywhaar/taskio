package api

import (
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// A stale API reference costs a reader the time to find out, so the one thing that actually
// rots — an endpoint added, renamed or removed — is pinned here. The prose is a human's job.
func TestTheRouteTableAndTheDocsAgree(t *testing.T) {
	s := newServer(t, nil)

	source, err := os.ReadFile("../../docs/api.md")
	if err != nil {
		t.Fatal(err)
	}
	documented := map[string]bool{}
	for _, line := range regexp.MustCompile(`(?m)^(GET|POST|PATCH|DELETE)\s+(/api/\S+)`).
		FindAllStringSubmatch(string(source), -1) {
		documented[line[1]+" "+normalise(line[2])] = true
	}

	// Only what a token can reach. The rest is the browser's, and a page written for an agent
	// documenting routes it cannot call would be worse than one that leaves them out.
	var missing []string
	for _, route := range s.AgentRoutes() {
		method, path, _ := strings.Cut(route, " ")
		if !documented[method+" "+normalise(path)] {
			missing = append(missing, route)
		}
	}
	sort.Strings(missing)
	for _, route := range missing {
		t.Errorf("%s is reachable with a token and not in docs/api.md", route)
	}
}

// The other half: a page describing an endpoint a token cannot call sends an agent at a 401.
func TestTheDocsDescribeNothingATokenCannotReach(t *testing.T) {
	s := newServer(t, nil)

	reachable := map[string]bool{}
	for _, route := range s.AgentRoutes() {
		method, path, _ := strings.Cut(route, " ")
		reachable[method+" "+normalise(path)] = true
	}

	source, err := os.ReadFile("../../docs/api.md")
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range regexp.MustCompile(`(?m)^(GET|POST|PATCH|DELETE)\s+(/api/\S+)`).
		FindAllStringSubmatch(string(source), -1) {
		route := line[1] + " " + normalise(line[2])
		if !reachable[route] {
			t.Errorf("docs/api.md documents %s, which a token cannot reach", route)
		}
	}
}

// normalise makes {id} and {slug} comparable however each side spells the parameter.
func normalise(path string) string {
	return regexp.MustCompile(`\{[^}]*\}`).ReplaceAllString(path, "{}")
}

// A model that has not been told a code cannot act on it.
func TestEveryCodeTheAPICanEmitIsDocumented(t *testing.T) {
	source, err := os.ReadFile("../../docs/api.md")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)

	for _, code := range []string{
		CodeInvalid, CodeFilterInvalid, CodeCursorInvalid,
		CodeUnauthenticated, CodeForbidden, CodeOutOfScope, CodeNotFound,
		CodePrefixAmbiguous, CodeRateLimited,
	} {
		if !strings.Contains(text, code) {
			t.Errorf("code %q is not in docs/api.md", code)
		}
	}
}
