// Package ids mints and validates every identifier in taskio.
//
// Three kinds, and one rule decides between them: a software-only identifier is a ULID, an
// identifier a person or a model types is short, and an identifier the caller has to compute
// without asking is derived. See docs/conventions.md.
package ids

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"strings"
)

// Alphabet is Crockford's base32, lowercased.
//
// It omits i, l, o and u, so an id cannot be misread between similar glyphs or accidentally
// spell a word. Lowercase because an id is read inside a URL and inside a sentence.
const Alphabet = "0123456789abcdefghjkmnpqrstvwxyz"

// Prefixes. A task carries none, and the absence is the marker: an id with no underscore in
// front of it is a task.
const (
	Principal = "p_"
	Invite    = "i_"
	Asset     = "a_"
	Token     = "k_"
	Session   = "s_"
	Tag       = "g_"
	// Group takes two letters because a tag already has the one it would want.
	Group = "gr_"
	// Recovery is a link back into an account, not the address one can be sent to.
	Recovery = "r_"
)

// How long each kind is.
const (
	// TaskLen is the whole of a task id: 8 characters over 40 random bits, 32⁸ of them.
	TaskLen = 8
	// TaskMinPrefix is the shortest prefix that names a task. Below it a value is a category
	// rather than an identifier, and the range scan would read a thirty-second of the table.
	TaskMinPrefix = 4

	// ulidLen is 26 characters over 16 bytes: a 6-byte big-endian millisecond timestamp then
	// 10 random, so ids sort chronologically.
	ulidLen = 26
	// derivedLen is how much of a hash names something. 12 hex characters is 48 bits.
	derivedLen = 12
)

// index maps a character to its value, with Crockford's substitutions folded in.
var index = func() map[byte]byte {
	m := make(map[byte]byte, 40)
	for i := 0; i < len(Alphabet); i++ {
		m[Alphabet[i]] = byte(i)
		m[upper(Alphabet[i])] = byte(i)
	}
	// Read off one screen and typed into another, these are the four that get confused.
	for _, sub := range []struct {
		from byte
		to   byte
	}{{'i', '1'}, {'l', '1'}, {'o', '0'}} {
		m[sub.from] = m[sub.to]
		m[upper(sub.from)] = m[sub.to]
	}
	return m
}()

func upper(c byte) byte {
	if c >= 'a' && c <= 'z' {
		return c - 'a' + 'A'
	}
	return c
}

// NewTask mints a task id.
//
// One crypto/rand read, no retry loop: a clash is caught by the UNIQUE index and retried by
// the caller, and at any size this will see the expected number of attempts is one.
func NewTask() string {
	var b [5]byte
	rand.Read(b[:])
	n := uint64(b[0])<<32 | uint64(b[1])<<24 | uint64(b[2])<<16 | uint64(b[3])<<8 | uint64(b[4])

	out := make([]byte, TaskLen)
	for i := TaskLen - 1; i >= 0; i-- {
		out[i] = Alphabet[n&31]
		n >>= 5
	}
	return string(out)
}

// NormalizeTask folds a typed task id or prefix into its canonical form.
//
// Case is ignored and Crockford's substitutions are applied; hyphens and spaces are stripped,
// since a code copied out of prose brings punctuation with it.
func NormalizeTask(s string) (string, error) {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == '-' || c == ' ' || c == '\t' {
			continue
		}
		v, ok := index[c]
		if !ok {
			return "", fmt.Errorf("%q is not a task id: %q is not one of its characters", s, string(c))
		}
		b.WriteByte(Alphabet[v])
	}
	out := b.String()
	switch {
	case len(out) < TaskMinPrefix:
		return "", fmt.Errorf("%q is too short to name a task: give at least %d characters", s, TaskMinPrefix)
	case len(out) > TaskLen:
		return "", fmt.Errorf("%q is too long to be a task id: they are %d characters", s, TaskLen)
	}
	return out, nil
}

// IsFullTask reports whether a normalised value is a whole id rather than a prefix.
func IsFullTask(normalized string) bool { return len(normalized) == TaskLen }

// PrefixBounds returns the half-open range that contains every id starting with prefix.
//
// One past the last byte rather than the next character in the alphabet: ids contain only
// alphabet bytes, so any byte above the last one bounds them, and 'z'+1 needs no carry. A
// range uses the index whatever the collation and the LIKE pragmas happen to be, which a GLOB
// does not promise.
func PrefixBounds(prefix string) (lo, hi string) {
	last := prefix[len(prefix)-1]
	return prefix, prefix[:len(prefix)-1] + string(last+1)
}

// New mints a prefixed ULID: a 6-byte big-endian millisecond timestamp then 10 random bytes,
// so ORDER BY id is a time order.
func New(prefix string, unixMilli int64) string {
	var b [16]byte
	binary.BigEndian.PutUint64(b[:8], uint64(unixMilli)<<16)
	rand.Read(b[6:])
	return prefix + encode32(b[:], ulidLen)
}

// Derive names something by hashing it, so whoever holds the thing can work the id out without
// asking the server first.
func Derive(prefix string, of []byte) string {
	sum := sha256.Sum256(of)
	return prefix + hex.EncodeToString(sum[:])[:derivedLen]
}

// Valid reports whether id is a well-formed identifier of the given prefix.
//
// Called before a value reaches a query, so a typo is a refusal naming the problem rather than
// an empty result that looks like a missing row.
func Valid(prefix, id string) bool {
	if !strings.HasPrefix(id, prefix) {
		return false
	}
	body := id[len(prefix):]
	switch len(body) {
	case ulidLen:
		for i := 0; i < len(body); i++ {
			if !strings.ContainsRune(Alphabet, rune(body[i])) {
				return false
			}
		}
		return true
	case derivedLen:
		_, err := hex.DecodeString(body)
		return err == nil
	}
	return false
}

// encode32 renders b as n characters of the alphabet, most significant first.
func encode32(b []byte, n int) string {
	out := make([]byte, n)
	var acc, bits uint32
	i := n
	for j := len(b) - 1; j >= 0; j-- {
		acc |= uint32(b[j]) << bits
		bits += 8
		for bits >= 5 && i > 0 {
			i--
			out[i] = Alphabet[acc&31]
			acc >>= 5
			bits -= 5
		}
	}
	for i > 0 {
		i--
		out[i] = Alphabet[acc&31]
		acc >>= 5
	}
	return string(out)
}
