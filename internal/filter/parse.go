package filter

import (
	"fmt"
	"strings"
)

type parser struct {
	in    string
	pos   int
	nodes int
}

// expr reads one expression at the given depth.
//
// Recursive descent with no precedence to get wrong: the parentheses are the structure, which
// is why the form is prefix rather than infix.
func (p *parser) expr(depth int) (*Node, error) {
	if depth > MaxDepth {
		return nil, fmt.Errorf("that filter nests deeper than %d", MaxDepth)
	}
	p.nodes++
	if p.nodes > MaxNodes {
		return nil, fmt.Errorf("that filter has more than %d parts in it", MaxNodes)
	}

	word, err := p.word()
	if err != nil {
		return nil, err
	}
	p.skipSpace()

	// A word followed by "(" is an operator; anything else is a slug.
	if p.peek() != '(' {
		if contains(Reserved, word) {
			return nil, fmt.Errorf("%q is an operator and needs arguments, like %s(home)", word, word)
		}
		if !ValidSlug(word) {
			return nil, fmt.Errorf("%q is not a tag: tags are lowercase letters, digits, - and _", word)
		}
		return &Node{Op: Leaf, Slug: word}, nil
	}

	op, ok := operator(word)
	if !ok {
		return nil, fmt.Errorf("%q is not an operator: use and, or or not", word)
	}
	p.pos++ // (

	var args []*Node
	for {
		p.skipSpace()
		if p.peek() == ')' {
			break
		}
		arg, err := p.expr(depth + 1)
		if err != nil {
			return nil, err
		}
		args = append(args, arg)
		p.skipSpace()
		if p.peek() == ',' {
			p.pos++
			continue
		}
		break
	}
	p.skipSpace()
	if p.peek() != ')' {
		return nil, fmt.Errorf("%s( is not closed", word)
	}
	p.pos++ // )

	switch {
	case len(args) == 0:
		// Two defensible meanings, everything and nothing, and no way to tell which somebody
		// meant. Asking for everything is what leaving the filter out does.
		return nil, fmt.Errorf("%s() has nothing in it", word)
	case op == Not && len(args) != 1:
		// not(a,b) is either not(or(a,b)) or not(and(a,b)) — different sets, both plausible,
		// and guessing between them is how a caller gets a confidently wrong answer.
		return nil, fmt.Errorf("not() takes one thing, and was given %d", len(args))
	}

	if op == And || op == Or {
		args = dedupe(args)
		if len(args) == 1 {
			return args[0], nil
		}
	}
	return &Node{Op: op, Args: args}, nil
}

func operator(word string) (Op, bool) {
	switch word {
	case "and":
		return And, true
	case "or":
		return Or, true
	case "not":
		return Not, true
	}
	return Leaf, false
}

// dedupe drops repeated arguments: what a caller assembling a list from two places produces,
// and it cannot mean anything else.
func dedupe(args []*Node) []*Node {
	seen := map[string]bool{}
	out := args[:0]
	for _, a := range args {
		key := Print(a)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, a)
	}
	return out
}

func (p *parser) word() (string, error) {
	start := p.pos
	for p.pos < len(p.in) {
		c := p.in[p.pos]
		if c == '(' || c == ')' || c == ',' || c == ' ' || c == '\t' || c == '\n' {
			break
		}
		p.pos++
	}
	if p.pos == start {
		if p.pos >= len(p.in) {
			return "", fmt.Errorf("the filter ends where a tag was expected")
		}
		return "", fmt.Errorf("expected a tag and found %q", string(p.in[p.pos]))
	}
	return strings.ToLower(p.in[start:p.pos]), nil
}

func (p *parser) skipSpace() {
	for p.pos < len(p.in) {
		switch p.in[p.pos] {
		case ' ', '\t', '\n', '\r':
			p.pos++
		default:
			return
		}
	}
}

func (p *parser) peek() byte {
	if p.pos >= len(p.in) {
		return 0
	}
	return p.in[p.pos]
}
