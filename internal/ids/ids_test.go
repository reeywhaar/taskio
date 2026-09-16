package ids

import (
	"strings"
	"testing"
	"time"
)

func TestATaskIDIsEightAlphabetCharacters(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 2000; i++ {
		id := NewTask()
		if len(id) != TaskLen {
			t.Fatalf("%q is %d characters, want %d", id, len(id), TaskLen)
		}
		for j := 0; j < len(id); j++ {
			if !strings.ContainsRune(Alphabet, rune(id[j])) {
				t.Fatalf("%q contains %q, which is not in the alphabet", id, string(id[j]))
			}
		}
		seen[id] = true
	}
	// Two thousand draws from 32⁸ should not repeat. If they do, minting is not random.
	if len(seen) != 2000 {
		t.Errorf("%d distinct ids from 2000 draws", len(seen))
	}
}

// The alphabet is the point: read off one screen and typed into another, these are the
// characters that get confused.
func TestNormalizeAppliesCrockfordsSubstitutions(t *testing.T) {
	for in, want := range map[string]string{
		"8QW4TZ9K":  "8qw4tz9k",
		"8qw4tz9k":  "8qw4tz9k",
		"8qw4-tz9k": "8qw4tz9k",
		"8qw4 tz9k": "8qw4tz9k",
		"IIII":      "1111",
		"llll":      "1111",
		"OOOO":      "0000",
		"8qw4":      "8qw4",
	} {
		got, err := NormalizeTask(in)
		if err != nil {
			t.Errorf("%q: %v", in, err)
			continue
		}
		if got != want {
			t.Errorf("%q normalised to %q, want %q", in, got, want)
		}
	}
}

// A refusal naming the problem, never a lookup that quietly returns nothing.
func TestNormalizeRefuses(t *testing.T) {
	for name, in := range map[string]string{
		"too short":              "8qw",
		"too long":               "8qw4tz9k0",
		"not in the alphabet":    "8qw4tz9!",
		"u is not a letter here": "8qw4tzu9",
		"empty":                  "",
	} {
		if got, err := NormalizeTask(in); err == nil {
			t.Errorf("%s: accepted %q as %q", name, in, got)
		}
	}
}

func TestIsFullTask(t *testing.T) {
	if IsFullTask("8qw4") {
		t.Error("a four-character prefix reported as a whole id")
	}
	if !IsFullTask("8qw4tz9k") {
		t.Error("a whole id reported as a prefix")
	}
}

// The bound has to contain every id starting with the prefix and nothing else, including when
// the last character is the highest in the alphabet.
func TestPrefixBoundsContainTheirPrefix(t *testing.T) {
	for _, prefix := range []string{"8qw4", "zzzz", "0000", "8qw4tz9k"} {
		lo, hi := PrefixBounds(prefix)
		for _, tail := range []string{"", "0", "z", "zzzz"} {
			id := prefix + tail
			if len(id) > TaskLen {
				continue
			}
			if !(id >= lo && id < hi) {
				t.Errorf("%q is outside [%q, %q)", id, lo, hi)
			}
		}
	}
}

func TestPrefixBoundsExcludeNeighbours(t *testing.T) {
	lo, hi := PrefixBounds("8qw4")
	for _, id := range []string{"8qw3zzzz", "8qw5", "8qx40000", "9qw4tz9k"} {
		if id >= lo && id < hi {
			t.Errorf("%q fell inside [%q, %q)", id, lo, hi)
		}
	}
}

func TestAULIDSortsChronologically(t *testing.T) {
	base := time.Date(2026, 9, 16, 4, 0, 0, 0, time.UTC).UnixMilli()
	earlier := New(Asset, base)
	later := New(Asset, base+1000)
	if !(earlier < later) {
		t.Errorf("%q should sort before %q", earlier, later)
	}
	if !Valid(Asset, earlier) || !Valid(Asset, later) {
		t.Error("a minted ULID does not validate")
	}
}

// Whoever holds the thing can work its id out without asking the server anything.
func TestDeriveIsStableAndPrefixed(t *testing.T) {
	a := Derive(Token, []byte("a secret"))
	b := Derive(Token, []byte("a secret"))
	if a != b {
		t.Errorf("%q and %q differ for one input", a, b)
	}
	if Derive(Token, []byte("another")) == a {
		t.Error("two inputs derived the same id")
	}
	if !Valid(Token, a) {
		t.Errorf("%q does not validate", a)
	}
}

func TestValidRefusesTheWrongShape(t *testing.T) {
	for name, id := range map[string]string{
		"wrong prefix":     Principal + "0123456789abcdef0123456789",
		"no prefix":        "0123456789abcdefghjkmnpqrs",
		"wrong length":     Asset + "abc",
		"outside alphabet": Asset + "iiiiiiiiiiiiiiiiiiiiiiiiii",
	} {
		if Valid(Asset, id) {
			t.Errorf("%s: %q validated", name, id)
		}
	}
}
