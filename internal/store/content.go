package store

import (
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"regexp"
	"strings"

	"taskio/internal/ids"
)

// What a description's text is scanned for on every write.
//
// Regular expressions rather than a markdown parse: they catch a link in a reference definition
// and inside an HTML comment, which a parse would not — and over-counting is safe here, while
// under-counting deletes an image somebody is using.
var (
	assetRef = regexp.MustCompile(`/api/assets/(a_[0-9a-z]{26})`)

	// A mention is @ and an id, and the @ must not follow a word character — which is what
	// keeps misha@example.com out of it.
	mentionRef = regexp.MustCompile(`(^|[^0-9A-Za-z_@])@([0-9A-Za-z]{4,8})`)

	// An inline image, turned into an asset and rewritten before the text is stored.
	//
	// Images only: a description carrying a base64 PDF is a file being uploaded through a text
	// field, and POST /api/assets is the route for that.
	dataURI = regexp.MustCompile(`data:(image/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)`)
)

// InlineMax is how many images one write may carry, and how many bytes of them.
//
// Two caps, because they bound two different things. Every embedded image costs the same fixed
// work whatever its size — a decode, a hash, a dedup lookup, two inserts — so a thousand
// hundred-byte PNGs weigh nothing against a byte budget and are still a thousand of those, in
// one transaction, on the one writer connection.
const InlineMax = 20

// inlineAssets turns every data: URI in text into a stored asset and rewrites the text.
//
// A stored description never contains one: they are accepted on the way in and nowhere else,
// which is what lets the extraction below look for a single shape and what keeps the description
// cap measuring prose rather than base64.
func (s *Store) inlineAssets(ctx context.Context, principalID, text string) (string, error) {
	matches := dataURI.FindAllStringSubmatchIndex(text, -1)
	if len(matches) == 0 {
		return text, nil
	}
	if len(matches) > InlineMax {
		return "", tooLarge("That is more than %d images in one task.", InlineMax)
	}
	limits, err := s.Limits(ctx)
	if err != nil {
		return "", err
	}

	var (
		out   strings.Builder
		last  int
		total int64
	)
	for _, m := range matches {
		kind := text[m[2]:m[3]]
		encoded := text[m[4]:m[5]]
		body, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return "", Invalid("One of those inline images is not valid base64.")
		}
		total += int64(len(body))
		if total > limits.AssetMaxBytes {
			return "", tooLarge("Inline images in one task come to more than %s.",
				bytesName(limits.AssetMaxBytes))
		}
		// The identical path an upload takes: a shortcut here would be a second place for the
		// SVG rule to be missing.
		asset, err := s.PutAsset(ctx, principalID, kind, body)
		if err != nil {
			return "", err
		}
		out.WriteString(text[last:m[0]])
		out.WriteString(asset.URL())
		last = m[1]
	}
	out.WriteString(text[last:])
	return out.String(), nil
}

// normalizeMentions rewrites every @prefix to the full id it names.
//
// Obeying the rule that a prefix is an input and never a value: a stored @8qw4 would name one
// task today and two the moment one minted next month shares those characters — a link with an
// expiry nobody set, sitting inside somebody's prose.
//
// What does not resolve is left exactly as typed and renders as plain text. Refusing to save a
// sentence because a word in it looks like an id and is not would be the worst possible trade,
// and resolution runs inside what the writer can see, so a scoped token cannot discover that a
// task exists by mentioning it and watching the rewrite.
func (s *Store) normalizeMentions(ctx context.Context, principalID string, scope []string, text string) string {
	return mentionRef.ReplaceAllStringFunc(text, func(match string) string {
		parts := mentionRef.FindStringSubmatch(match)
		lead, ref := parts[1], parts[2]
		normal, err := ids.NormalizeTask(ref)
		if err != nil {
			return match
		}
		id, err := s.ResolveTask(ctx, principalID, normal)
		if err != nil {
			return match
		}
		if !s.visible(ctx, principalID, id, scope) {
			return match
		}
		return lead + "@" + id
	})
}

// visible reports whether a task carries every slug a scope names.
//
// Resolution runs inside what the writer can see, so a confined credential cannot discover that
// a task exists by mentioning it and watching the rewrite.
func (s *Store) visible(ctx context.Context, principalID, id string, scope []string) bool {
	if len(scope) == 0 {
		return true
	}
	for _, slug := range scope {
		var n int
		err := s.reader.QueryRowContext(ctx,
			`SELECT count(*) FROM tasks JOIN task_tags ON task_tags.task_seq = tasks.seq
			  WHERE tasks.id = ? AND tasks.principal_id = ? AND task_tags.slug = ?`,
			id, principalID, slug).Scan(&n)
		if err != nil || n == 0 {
			return false
		}
	}
	return true
}

// syncContent rebuilds the two join tables from the saved text.
//
// Both from the text rather than from what the request asked for, so neither can drift from the
// words — and in the same transaction as the write, so they cannot disagree with it either.
func syncContent(ctx context.Context, tx *sql.Tx, seq int64, principalID string, scope []string, title, description string) error {
	text := title + "\n" + description

	if _, err := tx.ExecContext(ctx, `DELETE FROM task_assets WHERE task_seq = ?`, seq); err != nil {
		return fmt.Errorf("sync assets: %w", err)
	}
	for _, m := range assetRef.FindAllStringSubmatch(description, -1) {
		// Scoped to the owner: a reference to somebody else's asset is not a reference.
		var owned int
		if err := tx.QueryRowContext(ctx,
			`SELECT count(*) FROM assets WHERE id = ? AND principal_id = ?`, m[1], principalID).
			Scan(&owned); err != nil {
			return fmt.Errorf("sync assets: %w", err)
		}
		if owned == 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO task_assets (task_seq, asset_id) VALUES (?, ?)`, seq, m[1]); err != nil {
			return fmt.Errorf("sync assets: %w", err)
		}
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM task_mentions WHERE from_seq = ?`, seq); err != nil {
		return fmt.Errorf("sync mentions: %w", err)
	}
	for _, m := range mentionRef.FindAllStringSubmatch(text, -1) {
		if len(m[2]) != ids.TaskLen {
			continue
		}
		var to int64
		err := tx.QueryRowContext(ctx,
			`SELECT seq FROM tasks WHERE id = ? AND principal_id = ?`, m[2], principalID).Scan(&to)
		if err != nil || !linkVisible(ctx, tx, to, scope) {
			continue
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO task_mentions (from_seq, to_seq) VALUES (?, ?)`, seq, to); err != nil {
			return fmt.Errorf("sync mentions: %w", err)
		}
	}
	return nil
}

// linkVisible is visible, inside the transaction that is writing.
func linkVisible(ctx context.Context, tx *sql.Tx, seq int64, scope []string) bool {
	for _, slug := range scope {
		var n int
		if err := tx.QueryRowContext(ctx,
			`SELECT count(*) FROM task_tags WHERE task_seq = ? AND slug = ?`, seq, slug).Scan(&n); err != nil || n == 0 {
			return false
		}
	}
	return true
}

// Mentions is what a task names, and what names it.
type Mentions struct {
	Mentions    []*Task
	MentionedBy []*Task
}

// TaskMentions reads both directions, scoped the way everything else is.
//
// Backlinks are a query and never stored text: nothing writes one, nothing keeps one in step,
// and a deleted task leaves everybody's backlink list by cascade.
func (s *Store) TaskMentions(ctx context.Context, principalID string, seq int64) (*Mentions, error) {
	out := &Mentions{Mentions: []*Task{}, MentionedBy: []*Task{}}
	for _, dir := range []struct {
		query string
		into  *[]*Task
	}{
		{`SELECT to_seq FROM task_mentions WHERE from_seq = ?`, &out.Mentions},
		{`SELECT from_seq FROM task_mentions WHERE to_seq = ?`, &out.MentionedBy},
	} {
		rows, err := s.reader.QueryContext(ctx, dir.query, seq)
		if err != nil {
			return nil, fmt.Errorf("mentions: %w", err)
		}
		var seqs []int64
		for rows.Next() {
			var other int64
			if err := rows.Scan(&other); err != nil {
				rows.Close()
				return nil, err
			}
			seqs = append(seqs, other)
		}
		rows.Close()
		for _, other := range seqs {
			task, err := loadTaskBySeq(ctx, s.reader, other)
			if err != nil || task.PrincipalID != principalID {
				continue
			}
			*dir.into = append(*dir.into, task)
		}
	}
	return out, nil
}
