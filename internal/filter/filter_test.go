package filter

import (
	"strings"
	"testing"
)

// The table is the specification. Everything the grammar accepts, in its canonical spelling.
func TestParseAndPrint(t *testing.T) {
	for in, want := range map[string]string{
		"home":                           "home",
		"and(home)":                      "home",
		"and(home,chores)":               "and(home,chores)",
		"and( home , chores )":           "and(home,chores)",
		"AND(Home,Chores)":               "and(home,chores)",
		"and(home,home)":                 "home",
		"and(home,chores,home)":          "and(home,chores)",
		"not(work)":                      "not(work)",
		"or(and(home,chores),not(work))": "or(and(home,chores),not(work))",
		"and(work,not(archived))":        "and(work,not(archived))",
		"or(a,b,c)":                      "or(a,b,c)",
		"and(a,or(b,not(c)))":            "and(a,or(b,not(c)))",
		"home-repairs":                   "home-repairs",
		"a_1":                            "a_1",
	} {
		n, err := Parse(in)
		if err != nil {
			t.Errorf("%q: %v", in, err)
			continue
		}
		if got := Print(n); got != want {
			t.Errorf("%q printed as %q, want %q", in, got, want)
		}
	}
}

// Every refusal, and each one is a sentence a caller can act on.
func TestParseRefuses(t *testing.T) {
	for name, in := range map[string]string{
		"empty":               "",
		"empty and":           "and()",
		"empty or":            "or()",
		"empty not":           "not()",
		"not with two":        "not(a,b)",
		"unclosed":            "and(a,b",
		"unopened":            "a)",
		"unknown operator":    "xor(a,b)",
		"bare operator":       "and",
		"bare not":            "not",
		"operator as a tag":   "and(or,work)",
		"uppercase in a slug": "and(Home!,x)",
		"punctuation":         "home.repairs",
		"trailing rubbish":    "home chores",
		"slug too long":       strings.Repeat("a", MaxSlug+1),
	} {
		if n, err := Parse(in); err == nil {
			t.Errorf("%s: accepted %q as %q", name, in, Print(n))
		}
	}
}

// A refusal that does not say what was wrong has failed at the only job it had.
func TestRefusalsNameTheProblem(t *testing.T) {
	for in, want := range map[string]string{
		"not(a,b)": "one thing",
		"and()":    "nothing in it",
		"and(a,b":  "not closed",
		"xor(a,b)": "not an operator",
		"and":      "needs arguments",
	} {
		_, err := Parse(in)
		if err == nil {
			t.Errorf("%q was accepted", in)
			continue
		}
		if !strings.Contains(err.Error(), want) {
			t.Errorf("%q said %q, want it to mention %q", in, err, want)
		}
	}
}

func TestLimits(t *testing.T) {
	t.Run("bytes", func(t *testing.T) {
		if _, err := Parse("and(" + strings.Repeat("a,", MaxBytes) + "a)"); err == nil {
			t.Error("accepted a filter past the byte cap")
		}
	})
	t.Run("depth", func(t *testing.T) {
		in := strings.Repeat("not(", MaxDepth+1) + "a" + strings.Repeat(")", MaxDepth+1)
		if _, err := Parse(in); err == nil {
			t.Error("accepted a filter past the depth cap")
		}
	})
	t.Run("nodes", func(t *testing.T) {
		var parts []string
		for i := 0; i < MaxNodes+5; i++ {
			parts = append(parts, "a"+string(rune('a'+i%26))+string(rune('a'+i/26)))
		}
		if _, err := Parse("or(" + strings.Join(parts, ",") + ")"); err == nil {
			t.Error("accepted a filter past the node cap")
		}
	})
}

// Parse(Print(t)) == t over everything the table above accepts.
func TestRoundTrip(t *testing.T) {
	for _, in := range []string{
		"home", "and(home,chores)", "not(work)",
		"or(and(home,chores,repair),not(work))",
		"and(a,or(b,not(c)),d)",
	} {
		first, err := Parse(in)
		if err != nil {
			t.Fatal(err)
		}
		second, err := Parse(Print(first))
		if err != nil {
			t.Fatalf("printing %q produced something unparseable: %v", in, err)
		}
		if Print(first) != Print(second) {
			t.Errorf("%q round-tripped to %q", Print(first), Print(second))
		}
	}
}

// The value crossing into SQL is a caller's own string, so the emitted text must carry none
// of it.
func TestCompileInterpolatesNothing(t *testing.T) {
	// Slugs that would be refused by the parser are constructed directly: the assertion is
	// about the compiler, not about what gets past validation.
	n := &Node{Op: And, Args: []*Node{
		{Op: Leaf, Slug: "home'; DROP TABLE tasks; --"},
		{Op: Not, Args: []*Node{{Op: Leaf, Slug: "work"}}},
	}}
	sql, args := Compile(n, "tasks.seq")

	for _, bad := range []string{"DROP", "'", "home", "work"} {
		if strings.Contains(sql, bad) {
			t.Errorf("emitted SQL contains %q from the request: %s", bad, sql)
		}
	}
	if len(args) != 2 {
		t.Fatalf("args = %v", args)
	}
	if args[0] != "home'; DROP TABLE tasks; --" || args[1] != "work" {
		t.Errorf("args = %v, want the slugs bound in order", args)
	}
}

func TestCompileShape(t *testing.T) {
	for in, want := range map[string]string{
		"home":      "EXISTS (SELECT 1 FROM task_tags WHERE task_tags.task_seq = t.seq AND task_tags.slug = ?)",
		"not(work)": "NOT EXISTS (SELECT 1 FROM task_tags WHERE task_tags.task_seq = t.seq AND task_tags.slug = ?)",
	} {
		n, err := Parse(in)
		if err != nil {
			t.Fatal(err)
		}
		if got, _ := Compile(n, "t.seq"); got != want {
			t.Errorf("%q compiled to\n  %s\nwant\n  %s", in, got, want)
		}
	}

	n, _ := Parse("and(a,b)")
	got, args := Compile(n, "t.seq")
	if !strings.HasPrefix(got, "(EXISTS") || !strings.Contains(got, " AND EXISTS") {
		t.Errorf("and compiled to %s", got)
	}
	if len(args) != 2 {
		t.Errorf("args = %v", args)
	}

	n, _ = Parse("or(a,b)")
	if got, _ := Compile(n, "t.seq"); !strings.Contains(got, " OR EXISTS") {
		t.Errorf("or compiled to %s", got)
	}
}

func TestSlugsAreCollectedInFirstSeenOrder(t *testing.T) {
	n, err := Parse("or(and(home,chores),not(home),work)")
	if err != nil {
		t.Fatal(err)
	}
	got := Slugs(n)
	want := []string{"home", "chores", "work"}
	if len(got) != len(want) {
		t.Fatalf("slugs = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("slugs = %v, want %v", got, want)
		}
	}
}

// A scope and a request filter become one tree, so the caps bound the union rather than each
// half separately.
func TestAndAll(t *testing.T) {
	scope, _ := Parse("and(work)")
	req, _ := Parse("not(archived)")

	if got := Print(AndAll(scope, req)); got != "and(work,not(archived))" {
		t.Errorf("combined to %q", got)
	}
	if got := AndAll(nil, req); Print(got) != "not(archived)" {
		t.Errorf("a nil half was not dropped: %q", Print(got))
	}
	if AndAll(nil, nil) != nil {
		t.Error("two nils should combine to nothing")
	}
}

func TestReservedWordsAreNotSlugs(t *testing.T) {
	for _, word := range Reserved {
		if ValidSlug(word) {
			t.Errorf("%q is allowed as a tag, which makes %s(x) ambiguous", word, word)
		}
	}
}

// A session and an unscoped token both have no filter, so this is the ordinary call rather
// than a defensive one.
func TestSlugsOfNoFilter(t *testing.T) {
	if got := Slugs(nil); got != nil {
		t.Errorf("Slugs(nil) = %v, want nothing", got)
	}
}
