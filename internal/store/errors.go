package store

import (
	"errors"
	"fmt"
	"strings"
)

// The three sentinels every handler maps onto a status code, in one place.
//
// A handler that switches on a driver error is one that will disagree with another handler.
var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("already exists")
	ErrInvalid  = errors.New("invalid")

	// ErrTooLarge is its own sentinel because three different things answer 413 and a caller's
	// next move differs for each.
	ErrTooLarge = errors.New("too large")

	// ErrAmbiguous is a prefix that names more than one thing. A conflict, but not the same
	// conflict as a name already taken: the caller's next move is to send more characters
	// rather than to pick a different value, and the code has to say which.
	ErrAmbiguous = errors.New("ambiguous")

	// ErrTagsRequired is a scoped credential writing a task without tags its scope requires.
	// Invalid, but its own: the caller's next move is to send the tags the sentence names.
	ErrTagsRequired = errors.New("tags required")

	// ErrGone is something that existed and was deleted — a project a token still names.
	// Not found would tell it the project never was, and it has to be told what happened.
	ErrGone = errors.New("gone")
)

// These wrap a sentinel with a written sentence.
//
// The sentence is what reaches whoever reads it, so it is written for them: "There is no task
// 8qw4tz9k." rather than "not found: task 8qw4tz9k".
func NotFound(format string, a ...any) error  { return classify(ErrNotFound, format, a...) }
func Conflict(format string, a ...any) error  { return classify(ErrConflict, format, a...) }
func Invalid(format string, a ...any) error   { return classify(ErrInvalid, format, a...) }
func Ambiguous(format string, a ...any) error { return classify(ErrAmbiguous, format, a...) }
func Gone(format string, a ...any) error      { return classify(ErrGone, format, a...) }

// TagsRequired names what a scoped write left out, and where to ask for the whole list.
func TagsRequired(missing []string) error {
	them := "them"
	if len(missing) == 1 {
		them = "it"
	}
	return classify(ErrTagsRequired,
		"This token writes only tasks tagged %s here. Put %s in tags; GET /api/scope lists what it requires.",
		strings.Join(missing, " and "), them)
}

// TagsRequiredAny is the same refusal for a scope any one of whose tags will do.
func TagsRequiredAny(options []string) error {
	return classify(ErrTagsRequired,
		"This token writes only tasks tagged %s here. Put one of them in tags; GET /api/scope lists what it requires.",
		strings.Join(options, " or "))
}

func classify(kind error, format string, a ...any) error {
	return &classified{kind: kind, msg: fmt.Sprintf(format, a...)}
}

type classified struct {
	kind error
	msg  string
}

func (c *classified) Error() string { return c.msg }
func (c *classified) Unwrap() error { return c.kind }
