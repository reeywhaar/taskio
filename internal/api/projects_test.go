package api

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"
)

// project makes one and returns its body.
func (c *client) project(body string) map[string]any {
	c.t.Helper()
	resp := c.do("POST", "/api/projects", body)
	if resp.StatusCode != http.StatusCreated {
		c.t.Fatalf("create project = %s", resp.Status)
	}
	return c.json(resp)
}

// refusal reads a refusal's code and message.
func refusal(t *testing.T, resp *http.Response, status int) errorBody {
	t.Helper()
	if resp.StatusCode != status {
		t.Fatalf("status = %s, want %d", resp.Status, status)
	}
	var body errorBody
	json.NewDecoder(resp.Body).Decode(&body)
	return body
}

// mintRows mints a token reaching the projects given, each with its scope.
func mintRows(t *testing.T, s *Server, c *client, rows string) *agent {
	t.Helper()
	resp := c.do("POST", "/api/tokens", `{"label":"agent","projects":`+rows+`}`)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("mint = %s", resp.Status)
	}
	return &agent{t: t, server: s, secret: c.json(resp)["secret"].(string)}
}

func TestANewAccountHasOneDefaultProject(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	list := c.json(c.do("GET", "/api/projects", ""))["projects"].([]any)
	if len(list) != 1 {
		t.Fatalf("projects = %v, want one", list)
	}
	main := list[0].(map[string]any)
	if main["name"] != "Main" || main["slug"] != "main" || main["default"] != true {
		t.Errorf("default project = %v", main)
	}
}

// A hard separation: another project's tasks, tags and groups are not in this one.
func TestAProjectHasItsOwnTasksTagsAndGroups(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	// Digits kept, everything else a hyphen.
	garden := c.project(`{"name":"Side Project 2"}`)
	if garden["slug"] != "side-project-2" {
		t.Fatalf("slug = %v, want side-project-2", garden["slug"])
	}

	c.task(`{"title":"Fix the tap","tags":["home"]}`)
	resp := c.do("POST", "/api/tasks?project=side-project-2", `{"title":"Ship the form","tags":["release"]}`)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create in a project = %s", resp.Status)
	}
	if got := c.json(resp)["project"]; got != "side-project-2" {
		t.Errorf("a task's project = %v", got)
	}

	if got := titles(c.list("")); !slices.Equal(got, []string{"Fix the tap"}) {
		t.Errorf("the default project lists %v", got)
	}
	if got := titles(c.list("?project=side-project-2")); !slices.Equal(got, []string{"Ship the form"}) {
		t.Errorf("the other project lists %v", got)
	}

	tags := func(query string) []string {
		var out []string
		for _, tag := range c.json(c.do("GET", "/api/tags"+query, ""))["tags"].([]any) {
			out = append(out, tag.(map[string]any)["slug"].(string))
		}
		return out
	}
	if got := tags(""); !slices.Equal(got, []string{"home"}) {
		t.Errorf("the default project's tags = %v", got)
	}
	if got := tags("?project=side-project-2"); !slices.Equal(got, []string{"release"}) {
		t.Errorf("the other project's tags = %v", got)
	}

	c.do("POST", "/api/groups?project=side-project-2", `{"name":"Launch","tags":["release"]}`)
	if n := len(c.json(c.do("GET", "/api/groups", ""))["groups"].([]any)); n != 0 {
		t.Errorf("the default project has %d groups, want the other project's kept out", n)
	}
}

// A move takes the task's tags with it: they are the new project's tags from there.
func TestMovingATaskTakesItsTags(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.project(`{"name":"Garden"}`)
	id := c.task(`{"title":"Ship the form","tags":["release"]}`)["id"].(string)

	moved := c.json(c.do("PATCH", "/api/tasks/"+id, `{"project":"garden"}`))
	if moved["project"] != "garden" {
		t.Fatalf("moved to %v", moved["project"])
	}
	if len(titles(c.list(""))) != 0 || len(titles(c.list("?project=garden"))) != 1 {
		t.Error("the task did not leave one project for the other")
	}
	tags := c.json(c.do("GET", "/api/tags?project=garden", ""))["tags"].([]any)
	if len(tags) != 1 || tags[0].(map[string]any)["slug"] != "release" {
		t.Errorf("the new project's tags = %v", tags)
	}

	// And back, several at once.
	resp := c.do("POST", "/api/tasks/bulk/project", `{"ids":["`+id+`"],"project":"main"}`)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("bulk move = %s", resp.Status)
	}
	if len(titles(c.list(""))) != 1 {
		t.Error("the bulk move did not bring it back")
	}
}

// A rename keeps the slug, so every link naming the project keeps working. Changing the slug is
// a choice, and it breaks the old ones — which is why it is never done by a rename.
func TestARenameKeepsTheSlug(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.project(`{"name":"Garden"}`)["id"].(string)

	got := c.json(c.do("PATCH", "/api/projects/"+id, `{"name":"Side Project"}`))
	if got["name"] != "Side Project" || got["slug"] != "garden" {
		t.Errorf("renamed to %v, slug %v; want the slug kept", got["name"], got["slug"])
	}
	c.do("PATCH", "/api/projects/"+id, `{"slug":"side-project"}`)
	if resp := c.do("GET", "/api/tasks?project=garden", ""); resp.StatusCode != http.StatusNotFound {
		t.Errorf("the old slug = %s, want 404", resp.Status)
	}
	if resp := c.do("GET", "/api/tasks?project=side-project", ""); resp.StatusCode != http.StatusOK {
		t.Errorf("the new slug = %s", resp.Status)
	}

	// The default can be renamed and is still the default.
	main := c.json(c.do("GET", "/api/projects", ""))["projects"].([]any)[0].(map[string]any)
	c.do("PATCH", "/api/projects/"+main["id"].(string), `{"name":"Home"}`)
	if got := c.json(c.do("GET", "/api/projects", ""))["projects"].([]any)[0].(map[string]any); got["name"] != "Home" || got["default"] != true {
		t.Errorf("the renamed default = %v", got)
	}
}

// Deleting a project deletes what is in it, and a token still naming it is told so.
func TestDeletingAProjectDeletesItsTasks(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	garden := c.project(`{"name":"Garden"}`)
	c.do("POST", "/api/tasks?project=garden", `{"title":"Ship the form"}`)
	a := mintRows(t, s, c, `[{"project":"garden"}]`)

	if resp := c.do("DELETE", "/api/projects/"+garden["id"].(string), ""); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %s", resp.Status)
	}
	if n := len(c.json(c.do("GET", "/api/projects", ""))["projects"].([]any)); n != 1 {
		t.Errorf("projects after the delete = %d, want the default alone", n)
	}

	body := refusal(t, a.do("GET", "/api/tasks", ""), http.StatusGone)
	if body.Code != CodeProjectDeleted || !strings.Contains(body.Message, "was deleted") {
		t.Errorf("a token naming the deleted project got %+v", body)
	}

	// Its slug is free again, and the new project is empty.
	c.project(`{"name":"Garden"}`)
	if n := len(titles(c.list("?project=garden"))); n != 0 {
		t.Errorf("the new project has %d tasks, want the deleted one's gone", n)
	}

	main := c.json(c.do("GET", "/api/projects", ""))["projects"].([]any)[0].(map[string]any)
	if resp := c.do("DELETE", "/api/projects/"+main["id"].(string), ""); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("deleting the default = %s, want 400", resp.Status)
	}
}

// Every token minted before projects reaches one, so it names none and keeps working.
func TestATokenReachingOneProjectNeedsNoProjectParam(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.project(`{"name":"Garden"}`)
	c.do("POST", "/api/tasks?project=garden", `{"title":"Ship the form"}`)
	c.task(`{"title":"Fix the tap"}`)

	a := mintRows(t, s, c, `[{"project":"garden"}]`)
	if got := titles(a.json(a.do("GET", "/api/tasks", ""))); !slices.Equal(got, []string{"Ship the form"}) {
		t.Errorf("a one-project token lists %v", got)
	}
	body := refusal(t, a.do("GET", "/api/tasks?project=main", ""), http.StatusForbidden)
	if body.Code != CodeOutOfScope {
		t.Errorf("a project it was not given = %+v", body)
	}
}

// A token reaching several has no default, and is told which it could mean.
func TestATokenReachingSeveralMustNameOne(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.project(`{"name":"Garden"}`)
	a := mintRows(t, s, c, `[{"project":"main"},{"project":"garden"}]`)

	for _, resp := range []*http.Response{
		a.do("GET", "/api/tasks", ""),
		a.do("POST", "/api/tasks", `{"title":"Where does this go"}`),
	} {
		body := refusal(t, resp, http.StatusBadRequest)
		if body.Code != CodeProjectRequired || !strings.Contains(body.Message, "main, garden") {
			t.Errorf("without a project = %+v, want both slugs named", body)
		}
	}
	if resp := a.do("POST", "/api/tasks?project=garden", `{"title":"Ship the form"}`); resp.StatusCode != http.StatusCreated {
		t.Errorf("naming one = %s", resp.Status)
	}
}

// Several tags on a row mean any one of them: to see a task, and to write one.
func TestAnOrRowNeedsOnlyOneOfItsTags(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"Garden thing","tags":["garden"]}`)
	c.task(`{"title":"Reading thing","tags":["reading"]}`)
	c.task(`{"title":"Private thing","tags":["private"]}`)
	a := mintRows(t, s, c, `[{"project":"main","scope":"or(garden,reading)"}]`)

	got := titles(a.json(a.do("GET", "/api/tasks", "")))
	if len(got) != 2 || slices.Contains(got, "Private thing") {
		t.Errorf("an or() row sees %v, want the garden and the reading one", got)
	}

	// One of them is enough; neither is refused, naming both.
	made := a.json(a.do("POST", "/api/tasks", `{"title":"Ship it","tags":["garden"]}`))
	if tags := made["tags"].([]any); len(tags) != 1 || tags[0] != "garden" {
		t.Errorf("tags = %v, want garden alone — nothing added", tags)
	}
	body := refusal(t, a.do("POST", "/api/tasks", `{"title":"Nowhere"}`), http.StatusBadRequest)
	if body.Code != CodeScopeTagsMissing || !strings.Contains(body.Message, "garden or reading") {
		t.Errorf("neither = %+v", body)
	}

	// An edit may drop one while the other stays, and not both.
	id := made["id"].(string)
	if resp := a.do("PATCH", "/api/tasks/"+id, `{"tags":["reading"]}`); resp.StatusCode != http.StatusOK {
		t.Errorf("swapping garden for reading = %s", resp.Status)
	}
	refusal(t, a.do("PATCH", "/api/tasks/"+id, `{"tags":["urgent"]}`), http.StatusBadRequest)
}

// It moves tasks between the projects it reaches, and nowhere else.
func TestATokenMovesOnlyBetweenItsProjects(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.project(`{"name":"Garden"}`)
	c.project(`{"name":"Other"}`)
	a := mintRows(t, s, c, `[{"project":"main"},{"project":"garden"}]`)
	id := a.json(a.do("POST", "/api/tasks?project=main", `{"title":"Ship it"}`))["id"].(string)

	if got := a.json(a.do("PATCH", "/api/tasks/"+id, `{"project":"garden"}`)); got["project"] != "garden" {
		t.Errorf("moved to %v", got["project"])
	}
	refusal(t, a.do("PATCH", "/api/tasks/"+id, `{"project":"other"}`), http.StatusForbidden)
}

// What GET /api/scope says, row by row, deleted ones included.
func TestTheScopeListsEveryRow(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	garden := c.project(`{"name":"Garden"}`)
	a := mintRows(t, s, c, `[{"project":"main","scope":"or(garden,reading)"},{"project":"garden"}]`)
	c.do("DELETE", "/api/projects/"+garden["id"].(string), "")

	rows := a.json(a.do("GET", "/api/scope", ""))["projects"].([]any)
	if len(rows) != 2 {
		t.Fatalf("rows = %v, want both", rows)
	}
	main, gone := rows[0].(map[string]any), rows[1].(map[string]any)
	if main["slug"] != "main" || main["match"] != "any" {
		t.Errorf("main = %v", main)
	}
	if gone["slug"] != "garden" || gone["deleted"] != true {
		t.Errorf("the deleted row = %v", gone)
	}
}

// A row naming no project is the default one, the same rule as a URL naming none.
func TestARowNamingNoProjectIsTheDefault(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.task(`{"title":"Fix the tap"}`)
	a := mintRows(t, s, c, `[{"project":"","scope":""}]`)
	if got := titles(a.json(a.do("GET", "/api/tasks", ""))); len(got) != 1 {
		t.Errorf("a token for the default project lists %v", got)
	}
}
