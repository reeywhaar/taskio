package search

import "testing"

// The table is the specification: scoring has no answer that can be derived, only one that can
// be agreed and then kept.
func TestWhatMatches(t *testing.T) {
	for name, tc := range map[string]struct {
		query, title string
		want         bool
	}{
		"exact prefix":     {"call", "Call the plumber", true},
		"substring":        {"plumb", "Call the plumber", true},
		"word start":       {"the", "Call the plumber", true},
		"initials":         {"ctp", "Call the plumber", true},
		"dropped vowels":   {"plmb", "Call the plumber", true},
		"transposition":    {"plumebr", "Call the plumber", true},
		"one wrong letter": {"plumbar", "Call the plumber", true},
		"case":             {"PLUMB", "Call the plumber", true},

		"unrelated":           {"zebra", "Call the plumber", false},
		"not a subsequence":   {"bmulp", "Call the plumber", false},
		"empty":               {"", "Call the plumber", false},
		"too far":             {"plmbrxyz", "Call the plumber", false},
		"short and unrelated": {"tpa", "Write the report", false},
	} {
		t.Run(name, func(t *testing.T) {
			_, ok := Score(tc.query, tc.title)
			if ok != tc.want {
				t.Errorf("Score(%q, %q) matched = %v, want %v", tc.query, tc.title, ok, tc.want)
			}
		})
	}
}

// Ranking is the half a plain LIKE cannot do.
func TestBetterMatchesScoreHigher(t *testing.T) {
	for _, tc := range []struct {
		query, better, worse string
	}{
		{"tap", "Fix the tap", "Order the part"},
		{"plumb", "Call the plumber", "Plan a plumbing survey and replace the bathroom fittings"},
		{"call", "Call the plumber", "Recall the delivery"},
		{"plumber", "Call the plumber", "Call the plumbar"},
	} {
		b, okB := Score(tc.query, tc.better)
		w, okW := Score(tc.query, tc.worse)
		if !okB {
			t.Errorf("%q did not match %q at all", tc.query, tc.better)
			continue
		}
		if okW && w >= b {
			t.Errorf("%q scored %q at %d and %q at %d, want the first higher",
				tc.query, tc.better, b, tc.worse, w)
		}
	}
}

// A two-character query must not match everything, or the filter box is noise as you type.
func TestAShortQueryIsNotAWildcard(t *testing.T) {
	matched := 0
	for _, title := range []string{
		"Call the plumber", "Order the part", "Fix the tap",
		"Write the report", "Book the dentist",
	} {
		if _, ok := Score("zq", title); ok {
			matched++
		}
	}
	if matched > 0 {
		t.Errorf("a two-character query matched %d unrelated titles", matched)
	}
}

// A match in the description is below every match in a title, because a title is what somebody
// is trying to remember.
func TestADescriptionMatchRanksBelowEveryTitleMatch(t *testing.T) {
	worst, ok := Score("plmbrx", "plumberx")
	if !ok {
		t.Skip("no typo match to compare against")
	}
	if DescriptionScore >= worst {
		t.Errorf("DescriptionScore %d is not below the weakest title match %d", DescriptionScore, worst)
	}
}
