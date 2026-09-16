// Package filter is the tag filter: parse, print, compile. Pure.
//
// Everything that changes if the grammar grows is in here, and nothing outside knows the shape
// of what it parsed. It opens no transaction, reads no clock, and knows nothing about tags
// beyond their slugs, which is what makes the limits and the empty cases a table of inputs and
// expected outputs rather than a fixture.
package filter

import (
	"fmt"
	"strings"
)

// Limits. Enforced by the parser, so they are a property of the language rather than of one
// endpoint, and the same caps bound a token's scope.
const (
	MaxBytes = 1024
	MaxDepth = 8
	MaxNodes = 64
	MaxSlug  = 40
)

// Op is what a node does. A leaf carries a slug and no children.
type Op int

const (
	Leaf Op = iota
	And
	Or
	Not
)

// Node is one step of a parsed filter.
type Node struct {
	Op   Op
	Slug string
	Args []*Node
}

// Reserved are the three words that cannot be slugs.
//
// All three, although only one is ambiguous today: reserving a word costs nothing now and is
// impossible on the day somebody already has a tag called it.
var Reserved = []string{"and", "or", "not"}

// Parse reads a filter expression. Errors are sentences, because they reach a caller that has
// to act on them.
func Parse(s string) (*Node, error) {
	if len(s) > MaxBytes {
		return nil, fmt.Errorf("that filter is %d bytes and the limit is %d", len(s), MaxBytes)
	}
	p := &parser{in: s}
	p.skipSpace()
	n, err := p.expr(1)
	if err != nil {
		return nil, err
	}
	p.skipSpace()
	if p.pos != len(p.in) {
		return nil, fmt.Errorf("there is more after the end of the filter: %q", s[p.pos:])
	}
	return n, nil
}

// Print renders a node back to its minimal spelling: no spaces, arguments in the order given.
//
// Order is preserved rather than sorted, because the pill row draws them in it.
func Print(n *Node) string {
	var b strings.Builder
	write(&b, n)
	return b.String()
}

func write(b *strings.Builder, n *Node) {
	if n.Op == Leaf {
		b.WriteString(n.Slug)
		return
	}
	b.WriteString(name(n.Op))
	b.WriteByte('(')
	for i, a := range n.Args {
		if i > 0 {
			b.WriteByte(',')
		}
		write(b, a)
	}
	b.WriteByte(')')
}

func name(op Op) string {
	switch op {
	case And:
		return "and"
	case Or:
		return "or"
	case Not:
		return "not"
	}
	return ""
}

// Slugs returns every distinct slug the filter names, in first-seen order.
//
// The store resolves them together, so a caller that got three wrong learns all three from one
// refusal rather than three round trips.
//
// A nil filter names none. That is the ordinary case rather than a mistake — a session and an
// unscoped token both have one — so the answer belongs here instead of in a guard at each of
// the call sites, where the one that is forgotten is a panic.
func Slugs(n *Node) []string {
	if n == nil {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	var walk func(*Node)
	walk = func(n *Node) {
		if n.Op == Leaf {
			if !seen[n.Slug] {
				seen[n.Slug] = true
				out = append(out, n.Slug)
			}
			return
		}
		for _, a := range n.Args {
			walk(a)
		}
	}
	walk(n)
	return out
}

// Compile emits SQL over task_tags with one placeholder per slug.
//
// taskSeq names the column to correlate against, so the caller owns the alias. Every value is
// bound and nothing is interpolated: the returned string is `?`-shaped and the args are slugs
// the parser already validated.
func Compile(n *Node, taskSeq string) (string, []any) {
	var b strings.Builder
	var args []any
	compile(&b, &args, n, taskSeq)
	return b.String(), args
}

func compile(b *strings.Builder, args *[]any, n *Node, taskSeq string) {
	switch n.Op {
	case Leaf:
		// EXISTS per slug rather than a join with GROUP BY ... HAVING count(*) = n. The
		// aggregate form cannot express "has none of these", so it stops composing the moment
		// Not appears — and NOT EXISTS is what makes a task with no tags match one.
		b.WriteString("EXISTS (SELECT 1 FROM task_tags WHERE task_tags.task_seq = ")
		b.WriteString(taskSeq)
		b.WriteString(" AND task_tags.slug = ?)")
		*args = append(*args, n.Slug)
	case Not:
		b.WriteString("NOT ")
		compile(b, args, n.Args[0], taskSeq)
	case And, Or:
		joiner := " AND "
		if n.Op == Or {
			joiner = " OR "
		}
		b.WriteByte('(')
		for i, a := range n.Args {
			if i > 0 {
				b.WriteString(joiner)
			}
			compile(b, args, a, taskSeq)
		}
		b.WriteByte(')')
	}
}

// AndAll combines filters into one, dropping the nils.
//
// A token's scope and a request's filter go through here, so the union is checked against the
// caps once rather than each half passing and the total escaping.
func AndAll(nodes ...*Node) *Node {
	var args []*Node
	for _, n := range nodes {
		if n != nil {
			args = append(args, n)
		}
	}
	switch len(args) {
	case 0:
		return nil
	case 1:
		return args[0]
	}
	return &Node{Op: And, Args: args}
}

// Count is how many nodes a tree holds, which is what MaxNodes bounds.
func Count(n *Node) int {
	if n == nil {
		return 0
	}
	total := 1
	for _, a := range n.Args {
		total += Count(a)
	}
	return total
}

// ValidSlug reports whether s may be a tag.
func ValidSlug(s string) bool {
	if s == "" || len(s) > MaxSlug || contains(Reserved, s) {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		ok := c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_' || c == '-'
		if !ok {
			return false
		}
	}
	return true
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
