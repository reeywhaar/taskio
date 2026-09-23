package api

import (
	"net/http"
	"testing"
)

// A prefix is an input and never a value: one stored would name two tasks the moment a task
// minted next month shares those characters.
func TestAMentionIsRewrittenToTheFullID(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	target := c.task(`{"title":"Fix the tap"}`)["id"].(string)
	made := c.task(`{"title":"Preparation for @` + target[:4] + `"}`)

	if got := made["title"].(string); got != "Preparation for @"+target {
		t.Errorf("title = %q, want the prefix rewritten to %q", got, target)
	}
}

// Refusing to save a sentence because a word in it looks like an id and is not would be the
// worst possible trade.
func TestAMentionThatDoesNotResolveIsLeftAlone(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	made := c.task(`{"title":"About @zzzz and misha@example.com"}`)
	if got := made["title"].(string); got != "About @zzzz and misha@example.com" {
		t.Errorf("title = %q, want it untouched", got)
	}
}

// A word with the shape of a whole id is not a mention of one. "mentions" reads as ment10ns —
// i as 1, o as 0 — and was rewritten to that, in the middle of a sentence, from the editor.
func TestAWordShapedLikeAnIDIsLeftAlone(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	made := c.task(`{"title":"Spec","description":"so @mentions work across projects"}`)
	if got := made["description"].(string); got != "so @mentions work across projects" {
		t.Errorf("description = %q, want it untouched", got)
	}
}

// The @ must not follow a word character, which is what keeps an email address out of it.
func TestAnEmailAddressIsNotAMention(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	target := c.task(`{"title":"Fix the tap"}`)["id"].(string)

	// A prefix, so a rewrite would be visible: left as typed means it was never a mention.
	made := c.task(`{"title":"Mail misha@` + target[:4] + ` about it"}`)
	if got := made["title"].(string); got != "Mail misha@"+target[:4]+" about it" {
		t.Errorf("title = %q, want the address untouched", got)
	}
}

// Opening a task and seeing what refers to it is the half a link alone cannot do.
func TestMentionsAreCarriedBothWays(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	target := c.task(`{"title":"Fix the tap"}`)["id"].(string)
	source := c.task(`{"title":"Preparation for @` + target + `"}`)["id"].(string)

	from := c.json(c.do("GET", "/api/tasks/"+source, ""))
	mentions := from["mentions"].([]any)
	if len(mentions) != 1 || mentions[0].(map[string]any)["title"] != "Fix the tap" {
		t.Fatalf("mentions = %v", from["mentions"])
	}

	to := c.json(c.do("GET", "/api/tasks/"+target, ""))
	back := to["mentioned_by"].([]any)
	if len(back) != 1 || back[0].(map[string]any)["id"] != source {
		t.Fatalf("mentioned_by = %v", to["mentioned_by"])
	}
}

// Backlinks are a query, so a deleted task leaves everybody's list by cascade.
func TestDeletingATaskTakesItsMentions(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	target := c.task(`{"title":"Fix the tap"}`)["id"].(string)
	source := c.task(`{"title":"Preparation for @` + target + `"}`)["id"].(string)

	if resp := c.do("DELETE", "/api/tasks/"+source, ""); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %s", resp.Status)
	}
	to := c.json(c.do("GET", "/api/tasks/"+target, ""))
	if got := len(to["mentioned_by"].([]any)); got != 0 {
		t.Errorf("mentioned_by = %d after the mentioning task went", got)
	}
}

// Editing the text is what changes the links, because both are rebuilt from the saved words.
func TestEditingAMentionMovesTheLink(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	first := c.task(`{"title":"Fix the tap"}`)["id"].(string)
	second := c.task(`{"title":"Call the plumber"}`)["id"].(string)
	source := c.task(`{"title":"Preparation for @` + first + `"}`)["id"].(string)

	c.do("PATCH", "/api/tasks/"+source, `{"title":"Preparation for @`+second+`"}`)

	if got := len(c.json(c.do("GET", "/api/tasks/"+first, ""))["mentioned_by"].([]any)); got != 0 {
		t.Errorf("the old target still has %d backlinks", got)
	}
	if got := len(c.json(c.do("GET", "/api/tasks/"+second, ""))["mentioned_by"].([]any)); got != 1 {
		t.Errorf("the new target has %d backlinks", got)
	}
}

// A scoped token cannot discover that a task exists by mentioning it and watching the rewrite.
func TestAScopedTokenCannotResolveAMentionOutsideItsScope(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	hidden := c.task(`{"title":"Private thing","tags":["private"]}`)["id"].(string)
	a := mintToken(t, s, c, "claude", "and(work)")

	made := jsonOf(t, a.do("POST", "/api/tasks", `{"title":"About @`+hidden[:4]+`"}`))
	if got := made["title"].(string); got != "About @"+hidden[:4] {
		t.Errorf("title = %q, want the prefix left as typed", got)
	}
}

// It is a graph, not a tree: no cycle check, nothing to validate beyond the id existing.
func TestTwoTasksMayMentionEachOther(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	first := c.task(`{"title":"First"}`)["id"].(string)
	second := c.task(`{"title":"Second, see @` + first + `"}`)["id"].(string)
	c.do("PATCH", "/api/tasks/"+first, `{"title":"First, see @`+second+`"}`)

	for _, id := range []string{first, second} {
		body := c.json(c.do("GET", "/api/tasks/"+id, ""))
		if len(body["mentions"].([]any)) != 1 || len(body["mentioned_by"].([]any)) != 1 {
			t.Errorf("%s: mentions=%v mentioned_by=%v", id, body["mentions"], body["mentioned_by"])
		}
	}
}
