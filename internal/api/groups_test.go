package api

import (
	"encoding/json"
	"net/http"
	"slices"
	"testing"
)

func groupNames(body map[string]any) []string {
	out := []string{}
	for _, row := range body["groups"].([]any) {
		out = append(out, row.(map[string]any)["name"].(string))
	}
	return out
}

func TestAGroupIsANameAndSomeTags(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	resp := c.do("POST", "/api/groups", `{"name":"Work","tags":["work","proxio"]}`)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create = %s", resp.Status)
	}
	made := c.json(resp)
	if made["name"] != "Work" {
		t.Errorf("name = %v", made["name"])
	}

	list := c.json(c.do("GET", "/api/groups", ""))
	if got := groupNames(list); len(got) != 1 || got[0] != "Work" {
		t.Fatalf("groups = %v", got)
	}
	tags := list["groups"].([]any)[0].(map[string]any)["tags"].([]any)
	if len(tags) != 2 || tags[0] != "proxio" || tags[1] != "work" {
		t.Errorf("tags = %v, want them sorted", tags)
	}
}

// Naming the group is often where somebody decides the tag exists.
func TestAGroupCanNameATagNothingCarries(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	resp := c.do("POST", "/api/groups", `{"name":"Someday","tags":["someday"]}`)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create = %s", resp.Status)
	}
	if got := c.json(c.do("GET", "/api/tags", ""))["tags"].([]any); len(got) != 0 {
		t.Errorf("the tag listing has %d in it — a group should not make a tag exist", len(got))
	}
}

func TestAGroupIsEditedWholeAndCanBeDeleted(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.json(c.do("POST", "/api/groups", `{"name":"Work","tags":["work"]}`))["id"].(string)

	resp := c.do("PATCH", "/api/groups/"+id, `{"name":"Day job","tags":["work","job"]}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch = %s", resp.Status)
	}
	after := c.json(resp)
	if after["name"] != "Day job" || len(after["tags"].([]any)) != 2 {
		t.Errorf("after = %v", after)
	}

	if resp := c.do("DELETE", "/api/groups/"+id, ""); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %s", resp.Status)
	}
	if got := groupNames(c.json(c.do("GET", "/api/groups", ""))); len(got) != 0 {
		t.Errorf("groups = %v, want none", got)
	}
}

// All is not stored, so a group with no tags would be a second one of it that does nothing.
func TestAGroupNeedsANameAndATag(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	for _, body := range []string{
		`{"name":"","tags":["work"]}`,
		`{"name":"Work","tags":[]}`,
	} {
		resp := c.do("POST", "/api/groups", body)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s = %s, want 400", body, resp.Status)
		}
		var out errorBody
		json.NewDecoder(resp.Body).Decode(&out)
		if out.Message == "" {
			t.Errorf("%s was refused without saying why", body)
		}
	}
}

func TestOneAccountCannotSeeAnothersGroups(t *testing.T) {
	s, st := newServerStore(t, nil)
	mine := signIn(t, s, st)
	id := mine.json(mine.do("POST", "/api/groups", `{"name":"Work","tags":["work"]}`))["id"].(string)

	account(t, st, "other", "a good password")
	theirs := newClient(t, s)
	theirs.do("POST", "/api/auth/login", `{"username":"other","password":"a good password"}`)

	if got := groupNames(theirs.json(theirs.do("GET", "/api/groups", ""))); len(got) != 0 {
		t.Errorf("another account's groups = %v", got)
	}
	if resp := theirs.do("DELETE", "/api/groups/"+id, ""); resp.StatusCode != http.StatusNotFound {
		t.Errorf("deleting another account's group = %s, want 404", resp.Status)
	}
}

// A scoped token must not learn tag names its scope does not reach, and a group is a list of
// tag names.
func TestATokenCannotReachGroups(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	a := mintToken(t, s, c, "claude", "")

	if resp := a.do("GET", "/api/groups", ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("a token listing groups = %s, want 401", resp.Status)
	}
}

// The color is what the tab wears, so it reaches a stylesheet and an SVG: one shape only.
func TestAGroupsColorIsSixHexDigitsOrNothing(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	resp := c.do("POST", "/api/groups", `{"name":"Work","tags":["work"],"color":"#2563EB"}`)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create = %s", resp.Status)
	}
	if got := c.json(resp)["color"]; got != "#2563eb" {
		t.Errorf("color = %v, want it lowercased", got)
	}

	for _, bad := range []string{`"red"`, `"#fff"`, `"#12345g"`, `"#ef6500; --x: y"`} {
		resp := c.do("POST", "/api/groups", `{"name":"X","tags":["work"],"color":`+bad+`}`)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("color %s = %s, want 400", bad, resp.Status)
		}
	}

	// And none at all is a group that wears the brand, not a group with a broken color.
	resp = c.do("POST", "/api/groups", `{"name":"Plain","tags":["home"]}`)
	if resp.StatusCode != http.StatusCreated || c.json(resp)["color"] != "" {
		t.Errorf("a group with no color = %s", resp.Status)
	}
}

// The rail is a list somebody arranged, not a log of when they wrote things.
func TestGroupsComeBackInTheOrderTheyWereDraggedInto(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	made := map[string]string{}
	for _, name := range []string{"One", "Two", "Three"} {
		made[name] = c.json(c.do("POST", "/api/groups",
			`{"name":"`+name+`","tags":["work"]}`))["id"].(string)
	}

	if got := groupNames(c.json(c.do("GET", "/api/groups", ""))); len(got) != 3 || got[0] != "One" {
		t.Fatalf("written order = %v", got)
	}

	body := `{"ids":["` + made["Three"] + `","` + made["One"] + `"]}`
	if resp := c.do("PUT", "/api/groups/order", body); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("order = %s", resp.Status)
	}
	// Two was not named, so it keeps its place after the ones that were.
	if got := groupNames(c.json(c.do("GET", "/api/groups", ""))); len(got) != 3 ||
		got[0] != "Three" || got[1] != "One" || got[2] != "Two" {
		t.Errorf("arranged = %v, want Three, One, Two", got)
	}
}

// A group written in another tab mid-drag lands at the end rather than at the top.
func TestAGroupArrangedAroundKeepsItsPlace(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	first := c.json(c.do("POST", "/api/groups", `{"name":"One","tags":["work"]}`))["id"].(string)
	if resp := c.do("PUT", "/api/groups/order", `{"ids":["`+first+`"]}`); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("order = %s", resp.Status)
	}

	c.do("POST", "/api/groups", `{"name":"Later","tags":["home"]}`)
	if got := groupNames(c.json(c.do("GET", "/api/groups", ""))); len(got) != 2 || got[1] != "Later" {
		t.Errorf("groups = %v, want the new one last", got)
	}
}

func TestATokenCannotArrangeGroups(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	a := mintToken(t, s, c, "claude", "")

	if resp := a.do("PUT", "/api/groups/order", `{"ids":[]}`); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("a token arranging groups = %s, want 401", resp.Status)
	}
}

// A group moves with the tasks it shows, the finished and binned ones too, and their tags join
// the new project's arrangement in the order the old one had them. A task carrying only some of
// its tags stays.
func TestMovingAGroupTakesTheTasksItShows(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	c.project(`{"name":"Garden"}`)
	c.do("POST", "/api/tasks?project=garden", `{"title":"Sow the beans","tags":["seeds"]}`)

	c.task(`{"title":"Fix the tap","tags":["home","plumbing"]}`)
	done := c.task(`{"title":"Buy washers","tags":["shop","home","plumbing"]}`)["id"].(string)
	c.do("POST", "/api/tasks/"+done+"/done", "")
	binned := c.task(`{"title":"Call a plumber","tags":["home","plumbing"]}`)["id"].(string)
	c.do("DELETE", "/api/tasks/"+binned, "")
	c.task(`{"title":"Paint the fence","tags":["home"]}`)
	c.do("PUT", "/api/tags/order", `{"slugs":["shop","plumbing","home"]}`)

	id := c.json(c.do("POST", "/api/groups", `{"name":"Plumbing","tags":["home","plumbing"]}`))["id"].(string)
	resp := c.do("PATCH", "/api/groups/"+id, `{"name":"Pipes","tags":["home","plumbing"],"color":"#2563eb","project":"garden"}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("move = %s", resp.Status)
	}

	if got := groupNames(c.json(c.do("GET", "/api/groups", ""))); len(got) != 0 {
		t.Errorf("the default project still has %v", got)
	}
	moved := c.json(c.do("GET", "/api/groups?project=garden", ""))["groups"].([]any)
	if len(moved) != 1 || moved[0].(map[string]any)["name"] != "Pipes" || moved[0].(map[string]any)["color"] != "#2563eb" {
		t.Errorf("garden's groups = %v, want the one moved, as it was saved", moved)
	}

	if got := titles(c.list("?status=all")); !slices.Equal(got, []string{"Paint the fence"}) {
		t.Errorf("the default project kept %v", got)
	}
	got := titles(c.list("?project=garden&status=all"))
	slices.Sort(got)
	if !slices.Equal(got, []string{"Buy washers", "Call a plumber", "Fix the tap", "Sow the beans"}) {
		t.Errorf("garden has %v", got)
	}
	if c.statusOf(done) != "done" || c.statusOf(binned) != "deleted" {
		t.Errorf("moving changed a status: %s, %s", c.statusOf(done), c.statusOf(binned))
	}

	var tags []string
	for _, tag := range c.json(c.do("GET", "/api/tags?project=garden", ""))["tags"].([]any) {
		tags = append(tags, tag.(map[string]any)["slug"].(string))
	}
	if !slices.Equal(tags, []string{"seeds", "shop", "plumbing", "home"}) {
		t.Errorf("garden's tags = %v, want the moved ones after its own, in the old order", tags)
	}
}

func TestAGroupMovesOnlyToALiveProject(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	garden := c.project(`{"name":"Garden"}`)
	c.task(`{"title":"Fix the tap","tags":["home"]}`)
	id := c.json(c.do("POST", "/api/groups", `{"name":"Home","tags":["home"]}`))["id"].(string)
	c.do("DELETE", "/api/projects/"+garden["id"].(string), "")

	body := `{"name":"Home","tags":["home"],"project":"garden"}`
	if got := refusal(t, c.do("PATCH", "/api/groups/"+id, body), http.StatusGone); got.Code != CodeProjectDeleted {
		t.Errorf("a move to a deleted project = %+v", got)
	}
	refusal(t, c.do("PATCH", "/api/groups/"+id, `{"name":"Home","tags":["home"],"project":"nowhere"}`), http.StatusNotFound)

	// Where it already is, it stays, with its task.
	if resp := c.do("PATCH", "/api/groups/"+id, `{"name":"Home","tags":["home"],"project":"main"}`); resp.StatusCode != http.StatusOK {
		t.Fatalf("a move to where it is = %s", resp.Status)
	}
	if len(groupNames(c.json(c.do("GET", "/api/groups", "")))) != 1 || len(titles(c.list(""))) != 1 {
		t.Error("a move to where it is moved something")
	}
}
