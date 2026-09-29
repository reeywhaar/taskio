package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"taskio/internal/store"
)

// A timeline, oldest first, saying who wrote each: the account, and the token when one did.
func TestACommentSaysWhoWroteIt(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.task(`{"title":"Fix the tap"}`)["id"].(string)
	a := mintToken(t, s, c, "claude", "")

	if resp := c.do("POST", "/api/tasks/"+id+"/comments", `{"body":"Ordered **washers**."}`); resp.StatusCode != http.StatusCreated {
		t.Fatalf("a comment from a session = %s", resp.Status)
	}
	resp := a.do("POST", "/api/tasks/"+id+"/comments", `{"body":"Fitted them; it still drips."}`)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("a comment from a token = %s", resp.Status)
	}

	comments := c.json(c.do("GET", "/api/tasks/"+id, ""))["comments"].([]any)
	if len(comments) != 2 {
		t.Fatalf("comments = %v", comments)
	}
	first, second := comments[0].(map[string]any), comments[1].(map[string]any)
	if first["body"] != "Ordered **washers**." || first["token"] != "" || first["author"] == "" {
		t.Errorf("the session's comment = %v", first)
	}
	if second["token"] != "claude" || second["author"] != first["author"] {
		t.Errorf("the token's comment = %v, want the token's label beside the account", second)
	}
	// Not in the list, which stays one row a task.
	if _, there := c.list("")["tasks"].([]any)[0].(map[string]any)["comments"]; there {
		t.Error("the list carries comments")
	}
}

// Somebody writing about a task has looked at it.
func TestACommentPokesTheTask(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.task(`{"title":"Fix the tap"}`)["id"].(string)
	later := st.Now().Add(72 * time.Hour)
	st.SetClock(func() time.Time { return later })

	c.do("POST", "/api/tasks/"+id+"/comments", `{"body":"Still on it."}`)
	if got := c.json(c.do("GET", "/api/tasks/"+id, ""))["poked_at"]; got != float64(later.Unix()) {
		t.Errorf("poked_at = %v, want %d", got, later.Unix())
	}
}

// Part of the task's text: a mention in a comment links both ways, and an image in one is
// referenced, through a later edit of the description too.
func TestACommentIsPartOfTheTasksText(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.task(`{"title":"Fix the tap"}`)["id"].(string)
	other := c.task(`{"title":"Buy washers"}`)["id"].(string)

	encoded := base64.StdEncoding.EncodeToString(onePixel(t, 90))
	body, _ := json.Marshal(map[string]string{
		"body": "Needs @" + other[:5] + " first.\n\n![](data:image/png;base64," + encoded + ")",
	})
	made := c.json(c.do("POST", "/api/tasks/"+id+"/comments", string(body)))
	said := made["body"].(string)
	if !strings.Contains(said, "@"+other) || !strings.Contains(said, "/api/assets/a_") || strings.Contains(said, "data:image") {
		t.Fatalf("the comment was stored as %q, want the whole id and the asset's URL", said)
	}

	mentions := c.json(c.do("GET", "/api/tasks/"+id, ""))["mentions"].([]any)
	if len(mentions) != 1 || mentions[0].(map[string]any)["id"] != other {
		t.Errorf("mentions = %v, want the task the comment names", mentions)
	}
	back := c.json(c.do("GET", "/api/tasks/"+other, ""))["mentioned_by"].([]any)
	if len(back) != 1 || back[0].(map[string]any)["id"] != id {
		t.Errorf("mentioned_by = %v", back)
	}

	// An edit of the description rebuilds the references, and the comment's image stays one:
	// past the grace period the sweep leaves it.
	c.do("PATCH", "/api/tasks/"+id, `{"description":"Something else."}`)
	later := st.Now().Add(store.AssetGrace + time.Hour)
	st.SetClock(func() time.Time { return later })
	if _, err := st.SweepOrphanAssets(context.Background()); err != nil {
		t.Fatal(err)
	}
	url := said[strings.Index(said, "/api/assets/"):]
	url = strings.TrimSuffix(url, ")")
	if resp := c.do("GET", url, ""); resp.StatusCode != http.StatusOK {
		t.Errorf("the comment's image after an edit and a sweep = %s, want it kept", resp.Status)
	}
}

func TestACommentNeedsWordsAndAReach(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.task(`{"title":"Fix the tap","tags":["home"]}`)["id"].(string)

	refusal(t, c.do("POST", "/api/tasks/"+id+"/comments", `{"body":"   "}`), http.StatusBadRequest)

	// A token that does not reach the task cannot comment on it, refused as any write outside its
	// reach is.
	a := mintToken(t, s, c, "claude", "and(work)")
	if body := refusal(t, a.do("POST", "/api/tasks/"+id+"/comments", `{"body":"Hello"}`), http.StatusForbidden); body.Code != CodeOutOfScope {
		t.Errorf("a comment outside the token's reach got %+v", body)
	}
}

// Edited, a comment says so, and keeps who wrote it and when.
func TestACommentIsEditedAndSaysSo(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.task(`{"title":"Fix the tap"}`)["id"].(string)
	made := c.json(c.do("POST", "/api/tasks/"+id+"/comments", `{"body":"Ordred washers."}`))
	if made["edited_at"] != nil {
		t.Errorf("a new comment's edited_at = %v", made["edited_at"])
	}
	poked := c.json(c.do("GET", "/api/tasks/"+id, ""))["poked_at"]

	later := st.Now().Add(72 * time.Hour)
	st.SetClock(func() time.Time { return later })
	resp := c.do("PATCH", "/api/tasks/"+id+"/comments/"+made["id"].(string), `{"body":"Ordered washers."}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("an edit = %s", resp.Status)
	}
	edited := c.json(resp)
	if edited["body"] != "Ordered washers." || edited["edited_at"] != float64(later.Unix()) || edited["created_at"] != made["created_at"] {
		t.Errorf("the edited comment = %v", edited)
	}

	task := c.json(c.do("GET", "/api/tasks/"+id, ""))
	if got := task["comments"].([]any)[0].(map[string]any)["body"]; got != "Ordered washers." {
		t.Errorf("the timeline says %v", got)
	}
	// Correcting a word is not saying the task stands.
	if task["poked_at"] != poked {
		t.Errorf("poked_at = %v after an edit, want %v", task["poked_at"], poked)
	}

	refusal(t, c.do("PATCH", "/api/tasks/"+id+"/comments/"+made["id"].(string), `{"body":" "}`), http.StatusBadRequest)
	refusal(t, c.do("PATCH", "/api/tasks/"+id+"/comments/c_nothing", `{"body":"Hello"}`), http.StatusNotFound)
}

// A token edits its own words and nobody else's; the account edits any.
func TestATokenEditsOnlyItsOwnComments(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.task(`{"title":"Fix the tap"}`)["id"].(string)
	a := mintToken(t, s, c, "claude", "")
	b := mintToken(t, s, c, "helper", "")

	mine := c.json(c.do("POST", "/api/tasks/"+id+"/comments", `{"body":"Mine."}`))["id"].(string)
	its := a.json(a.do("POST", "/api/tasks/"+id+"/comments", `{"body":"The agent's."}`))["id"].(string)

	if resp := a.do("PATCH", "/api/tasks/"+id+"/comments/"+its, `{"body":"The agent's, fixed."}`); resp.StatusCode != http.StatusOK {
		t.Errorf("a token editing its own = %s", resp.Status)
	}
	if body := refusal(t, b.do("PATCH", "/api/tasks/"+id+"/comments/"+its, `{"body":"No."}`), http.StatusForbidden); body.Code != CodeForbidden {
		t.Errorf("another token editing the agent's got %+v", body)
	}
	if body := refusal(t, a.do("PATCH", "/api/tasks/"+id+"/comments/"+mine, `{"body":"No."}`), http.StatusForbidden); body.Code != CodeForbidden {
		t.Errorf("a token editing the session's got %+v", body)
	}

	resp := c.do("PATCH", "/api/tasks/"+id+"/comments/"+its, `{"body":"Tidied."}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("the account editing the agent's = %s", resp.Status)
	}
	// Still the agent's, edited.
	if got := c.json(resp); got["token"] != "claude" || got["edited_at"] == nil {
		t.Errorf("the agent's comment after the account's edit = %v", got)
	}
}
