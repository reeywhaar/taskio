package store

import (
	"errors"
	"fmt"
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
)

// NotFound, Conflict and Invalid wrap a sentinel with a written sentence.
//
// The sentence is what reaches whoever reads it, so it is written for them: "No task carries
// the tag \"chorse\"." rather than "not found: tag chorse".
func NotFound(format string, a ...any) error { return classify(ErrNotFound, format, a...) }
func Conflict(format string, a ...any) error { return classify(ErrConflict, format, a...) }
func Invalid(format string, a ...any) error  { return classify(ErrInvalid, format, a...) }

func classify(kind error, format string, a ...any) error {
	return &classified{kind: kind, msg: fmt.Sprintf(format, a...)}
}

type classified struct {
	kind error
	msg  string
}

func (c *classified) Error() string { return c.msg }
func (c *classified) Unwrap() error { return c.kind }
