// Package search scores a query against a title. Pure.
//
// A query and a candidate in, a number out. Scoring is judged by examples — does plmb find
// "Call the plumber", does tap put "Fix the tap" above "Order the part" — so the table beside
// this is the specification, and it can only be a table because nothing here reads a database.
package search

import "strings"

// Scores, highest first. The bands are wide so a better kind of match always beats a worse one
// however the bonuses fall.
const (
	scorePrefix      = 1000
	scoreWordStart   = 900
	scoreSubstring   = 800
	scoreInitials    = 700
	scoreSubsequence = 600
	scoreTypo        = 500

	// TagScore is what a match on one of the task's tags is worth.
	//
	// Below every title match and above a description: a tag is a word somebody chose and wrote
	// on the task, where a description is prose that merely happens to contain it. Flat, like
	// DescriptionScore — a tag is a slug of one or two words, so "how well" it matched is a
	// distinction with nothing behind it.
	TagScore = 300

	// DescriptionScore is what a match in the description alone is worth: below every title
	// match, because a title is what somebody is trying to remember.
	DescriptionScore = 100
)

// Score rates query against title, and reports whether it matched at all.
func Score(query, title string) (int, bool) {
	q := strings.ToLower(strings.TrimSpace(query))
	t := strings.ToLower(title)
	if q == "" {
		return 0, false
	}

	if strings.HasPrefix(t, q) {
		return scorePrefix + lengthBonus(q, t), true
	}
	if at := strings.Index(t, q); at >= 0 {
		if isWordStart(t, at) {
			return scoreWordStart + lengthBonus(q, t), true
		}
		return scoreSubstring + lengthBonus(q, t), true
	}
	if matchesInitials(q, t) {
		return scoreInitials + lengthBonus(q, t), true
	}
	if gaps, ok := subsequence(q, t); ok {
		// Fewer gaps is a tighter match: "plmb" in "plumber" beats it spread across a sentence.
		return scoreSubsequence - gaps, true
	}
	if d, ok := nearWord(q, t); ok {
		return scoreTypo - d*50, true
	}
	return 0, false
}

// lengthBonus prefers the shorter title when both match, so a query that is most of one title
// beats the same query buried in a longer one.
func lengthBonus(q, t string) int {
	if len(t) == 0 {
		return 0
	}
	return len(q) * 50 / len(t)
}

func isWordStart(s string, at int) bool {
	return at == 0 || !isWordByte(s[at-1])
}

func isWordByte(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= '0' && c <= '9'
}

// matchesInitials answers "cp" against "Call the plumber", which is how people refer to their
// own tasks out loud.
func matchesInitials(q, t string) bool {
	var initials []byte
	prev := byte(' ')
	for i := 0; i < len(t); i++ {
		if isWordByte(t[i]) && !isWordByte(prev) {
			initials = append(initials, t[i])
		}
		prev = t[i]
	}
	return strings.HasPrefix(string(initials), q) && len(q) > 1
}

// subsequence answers "plmb" against "plumber": every character in order, not necessarily
// adjacent. It returns how scattered the match was.
func subsequence(q, t string) (gaps int, ok bool) {
	i := 0
	last := -1
	for j := 0; j < len(t) && i < len(q); j++ {
		if t[j] == q[i] {
			if last >= 0 && j != last+1 {
				gaps++
			}
			last = j
			i++
		}
	}
	return gaps, i == len(q)
}

// nearWord answers the actual typo: a word of the title close enough to the query.
//
// Per word rather than over the whole title, so a short query is not "within two edits" of
// every long sentence.
func nearWord(q, t string) (int, bool) {
	cap := maxEdits(len(q))
	if cap == 0 {
		return 0, false
	}
	best := -1
	for _, word := range strings.FieldsFunc(t, func(r rune) bool { return !isWordByte(byte(r)) }) {
		if abs(len(word)-len(q)) > cap {
			continue
		}
		d := distance(q, word, cap)
		if d >= 0 && (best < 0 || d < best) {
			best = d
		}
	}
	return best, best >= 0
}

// maxEdits scales tolerance with the query.
//
// A flat two is wrong at three characters: nearly every short word is within two edits of
// nearly every other, so "tpa" would find "the". The transposition case is not lost by the
// tighter cap, because the distance below counts an adjacent swap as one edit rather than two.
func maxEdits(n int) int {
	switch {
	case n < 3:
		return 0
	case n < 6:
		return 1
	}
	return 2
}

// distance is optimal string alignment — Levenshtein plus adjacent transposition as one edit —
// with an early exit, since past the cap the exact number does not matter.
//
// Transposition counts as one because it is the commonest typo there is, and counting it as two
// would mean either missing it or widening the cap far enough to match unrelated words.
func distance(a, b string, cap int) int {
	rows := make([][]int, len(a)+1)
	for i := range rows {
		rows[i] = make([]int, len(b)+1)
		rows[i][0] = i
	}
	for j := 0; j <= len(b); j++ {
		rows[0][j] = j
	}
	for i := 1; i <= len(a); i++ {
		best := rows[i][0]
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			d := min3(rows[i][j-1]+1, rows[i-1][j]+1, rows[i-1][j-1]+cost)
			if i > 1 && j > 1 && a[i-1] == b[j-2] && a[i-2] == b[j-1] {
				if swap := rows[i-2][j-2] + 1; swap < d {
					d = swap
				}
			}
			rows[i][j] = d
			if d < best {
				best = d
			}
		}
		if best > cap {
			return -1
		}
	}
	if rows[len(a)][len(b)] > cap {
		return -1
	}
	return rows[len(a)][len(b)]
}

func min3(a, b, c int) int {
	if b < a {
		a = b
	}
	if c < a {
		a = c
	}
	return a
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
