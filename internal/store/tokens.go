package store

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"taskio/internal/filter"
)

// How a token is spelled on the wire.
const (
	// TokenPrefix marks a secret in a log and in a config file.
	TokenPrefix = "tk_"

	// NoncedPrefix marks what a nonced token puts on the wire, which is not a secret at all.
	//
	// It exists because this credential ends up in transcripts: a tool call carrying a raw
	// token is a live credential in a document nobody thinks of as one.
	NoncedPrefix = "tkc_"

	// NonceSep is a dot: unreserved in a URL, where a colon is a delimiter, so a nonced value
	// goes into a query parameter without escaping. No field can contain one — they are digits
	// and hex.
	NonceSep = "."

	// NonceWindow is how far a nonce may be from now, either way, to allow for clock skew.
	NonceWindow = 5 * time.Minute

	// hintLen is how much of a secret is kept to identify it in a listing, counted after the
	// prefix, which every secret carries and which therefore identifies nothing.
	hintLen = 8
)

// Token is an API credential belonging to one account.
type Token struct {
	// ID is the first 12 hex of sha256 of the secret. Derived, because a nonced value has to
	// name which token is being proved and is built by the caller, who has never asked the
	// server anything.
	ID          string
	PrincipalID string
	Label       string
	Hint        string
	Scope       string
	CreatedAt   time.Time
	ExpiresAt   *time.Time
	LastUsedAt  *time.Time
	RevokedAt   *time.Time
	// LastIP and LastAgent are where it was used from, for the one question a token raises:
	// used by what, from where.
	LastIP    string
	LastAgent string
	// IdleTTL is how long it may go unused before it stops working. Zero is never.
	IdleTTL time.Duration
}

// Idle reports whether this token has gone too long unused. Counted from the last use, or from
// the day it was minted if it has never been used at all.
func (t *Token) Idle(now time.Time) bool {
	if t.IdleTTL <= 0 {
		return false
	}
	since := t.CreatedAt
	if t.LastUsedAt != nil {
		since = *t.LastUsedAt
	}
	return now.Sub(since) > t.IdleTTL
}

// Live reports whether this token would authenticate now.
func (t *Token) Live(now time.Time) bool {
	return t.RevokedAt == nil &&
		(t.ExpiresAt == nil || t.ExpiresAt.After(now)) &&
		!t.Idle(now)
}

// ScopeFilter parses the scope, or nil for a token that reaches the whole account.
func (t *Token) ScopeFilter() (*filter.Node, error) {
	if t.Scope == "" {
		return nil, nil
	}
	return filter.Parse(t.Scope)
}

// CreateToken mints one and returns it with the secret, readable exactly once.
func (s *Store) CreateToken(ctx context.Context, principalID, label, scope string, expires *time.Time, idle time.Duration) (*Token, string, error) {
	label, err := cleanLabel(label)
	if err != nil {
		return nil, "", err
	}

	scope, err = canonicalScope(scope)
	if err != nil {
		return nil, "", err
	}

	raw, err := secret()
	if err != nil {
		return nil, "", err
	}
	value := TokenPrefix + raw

	tok := &Token{
		ID:          tokenID(value),
		PrincipalID: principalID,
		Label:       label,
		Hint:        raw[:hintLen],
		Scope:       scope,
		CreatedAt:   s.Now(),
		ExpiresAt:   expires,
		IdleTTL:     idle,
	}
	if idle < 0 {
		return nil, "", Invalid("That is not a length of time.")
	}
	var exp any
	if expires != nil {
		exp = unix(*expires)
	}
	_, err = s.writer.ExecContext(ctx,
		`INSERT INTO tokens (id, principal_id, label, secret_hash, hint, scope, created_at, expires_at, idle_ttl)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		tok.ID, principalID, label, tokenKey(value), tok.Hint, scope, unix(tok.CreatedAt), exp,
		int64(idle/time.Second))
	if err != nil {
		return nil, "", fmt.Errorf("create token: %w", err)
	}
	s.changed(principalID)
	return tok, value, nil
}

// Tokens lists one account's, newest first.
func (s *Store) Tokens(ctx context.Context, principalID string) ([]*Token, error) {
	rows, err := s.reader.QueryContext(ctx,
		`SELECT id, label, hint, scope, created_at, expires_at, last_used_at, revoked_at,
		        last_ip, last_agent, idle_ttl
		   FROM tokens WHERE principal_id = ? ORDER BY created_at DESC`, principalID)
	if err != nil {
		return nil, fmt.Errorf("list tokens: %w", err)
	}
	defer rows.Close()

	out := []*Token{}
	for rows.Next() {
		tok := &Token{PrincipalID: principalID}
		var created, idle int64
		var expires, used, revoked sql.NullInt64
		if err := rows.Scan(&tok.ID, &tok.Label, &tok.Hint, &tok.Scope, &created,
			&expires, &used, &revoked, &tok.LastIP, &tok.LastAgent, &idle); err != nil {
			return nil, err
		}
		tok.IdleTTL = time.Duration(idle) * time.Second
		tok.CreatedAt = time.Unix(created, 0).UTC()
		tok.ExpiresAt = nullTime(expires)
		tok.LastUsedAt = nullTime(used)
		tok.RevokedAt = nullTime(revoked)
		out = append(out, tok)
	}
	return out, rows.Err()
}

// canonicalScope validates a scope and returns the spelling it is stored under.
//
// Stored canonically rather than as whatever was typed, so a listing shows one shape and two
// spellings of one scope are one string. Shared by minting and editing: two copies of this is
// two answers to what a scope may be, and the one that drifts is whichever is read less.
func canonicalScope(scope string) (string, error) {
	if scope == "" {
		return "", nil
	}
	parsed, err := filter.Parse(scope)
	if err != nil {
		return "", Invalid("%s", err.Error())
	}
	if !isFlatAnd(parsed) {
		// Only an unnested and() of slugs answers "create it with these tags", which is what a
		// scope has to do.
		return "", Invalid("A scope is a flat and() of tags, like and(work,inbox).")
	}
	return filter.Print(parsed), nil
}

// cleanLabel is the one rule for what a token may be called, minted or renamed.
func cleanLabel(label string) (string, error) {
	label = strings.TrimSpace(label)
	if label == "" {
		return "", Invalid("A token needs a label, so it can be recognised later.")
	}
	if len(label) > 64 {
		return "", Invalid("That label is longer than 64 characters.")
	}
	return label, nil
}

// TokenChange is what an edit asks for. A nil field is left as it is.
type TokenChange struct {
	Label *string
	Scope *string
	// Expires set to the zero time clears it: the token stops expiring.
	Expires *time.Time
	Idle    *time.Duration
}

// UpdateToken changes everything about a token but its secret: what it is called, what it
// reaches, and when it stops working.
//
// The value itself does not change, so whatever holds it keeps working and sees the change on
// its next request. That is the point: the alternative is revoke and mint, which means finding
// every place the old value was pasted.
//
// An edit never stops a live token working. An expiry already past, or an idle limit it has
// already gone beyond, is refused — renaming a token must not be the way an agent's credential
// dies without anybody meaning it to. Revoke says that on purpose. A token that has already
// lapsed can still be edited, and given longer, which brings it back.
//
// A revoked token is refused rather than quietly updated. It reaches nothing either way, and
// succeeding would report a change that changes nothing.
func (s *Store) UpdateToken(ctx context.Context, principalID, id string, change TokenChange) (*Token, error) {
	was, err := s.token(ctx, principalID, id)
	if err != nil {
		return nil, err
	}
	if was.RevokedAt != nil {
		return nil, NotFound("There is no such token.")
	}

	now := s.Now()
	tok := *was
	if change.Label != nil {
		if tok.Label, err = cleanLabel(*change.Label); err != nil {
			return nil, err
		}
	}
	if change.Scope != nil {
		if tok.Scope, err = canonicalScope(*change.Scope); err != nil {
			return nil, err
		}
	}
	if change.Expires != nil {
		switch {
		case change.Expires.IsZero():
			tok.ExpiresAt = nil
		case !change.Expires.After(now):
			return nil, Invalid("That moment has already passed. To stop it working now, revoke it.")
		default:
			at := change.Expires.UTC().Truncate(time.Second)
			tok.ExpiresAt = &at
		}
	}
	if change.Idle != nil {
		if *change.Idle < 0 {
			return nil, Invalid("That is not a length of time.")
		}
		tok.IdleTTL = *change.Idle
		if was.Live(now) && tok.Idle(now) {
			return nil, Invalid("It has already gone unused for longer than that. To stop it working now, revoke it.")
		}
	}

	var exp any
	if tok.ExpiresAt != nil {
		exp = unix(*tok.ExpiresAt)
	}
	idle := int64(tok.IdleTTL / time.Second)
	// The comparison in the WHERE clause is what makes an identical save no change at all: no
	// row, no notification, and nothing for the backup loop to count.
	res, err := s.writer.ExecContext(ctx,
		`UPDATE tokens SET label = ?, scope = ?, expires_at = ?, idle_ttl = ?
		  WHERE principal_id = ? AND id = ? AND revoked_at IS NULL
		    AND (label <> ? OR scope <> ? OR expires_at IS NOT ? OR idle_ttl <> ?)`,
		tok.Label, tok.Scope, exp, idle, principalID, id, tok.Label, tok.Scope, exp, idle)
	if err != nil {
		return nil, fmt.Errorf("update token: %w", err)
	}
	if n, _ := res.RowsAffected(); n > 0 {
		s.changed(principalID)
	}
	return &tok, nil
}

// token reads one of an account's tokens, revoked or not.
func (s *Store) token(ctx context.Context, principalID, id string) (*Token, error) {
	tok := &Token{PrincipalID: principalID, ID: id}
	var created, idle int64
	var expires, used, revoked sql.NullInt64
	err := s.reader.QueryRowContext(ctx,
		`SELECT label, hint, scope, created_at, expires_at, last_used_at, revoked_at,
		        last_ip, last_agent, idle_ttl
		   FROM tokens WHERE principal_id = ? AND id = ?`, principalID, id).
		Scan(&tok.Label, &tok.Hint, &tok.Scope, &created, &expires, &used, &revoked,
			&tok.LastIP, &tok.LastAgent, &idle)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, NotFound("There is no such token.")
	}
	if err != nil {
		return nil, fmt.Errorf("read token: %w", err)
	}
	tok.CreatedAt = time.Unix(created, 0).UTC()
	tok.ExpiresAt = nullTime(expires)
	tok.LastUsedAt = nullTime(used)
	tok.RevokedAt = nullTime(revoked)
	tok.IdleTTL = time.Duration(idle) * time.Second
	return tok, nil
}

// RevokeToken marks one revoked rather than deleting it, so a token that turns up in a log
// afterwards can still be named.
func (s *Store) RevokeToken(ctx context.Context, principalID, id string) error {
	res, err := s.writer.ExecContext(ctx,
		`UPDATE tokens SET revoked_at = ? WHERE principal_id = ? AND id = ? AND revoked_at IS NULL`,
		unix(s.Now()), principalID, id)
	if err != nil {
		return fmt.Errorf("revoke token: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return NotFound("There is no such token.")
	}
	s.changed(principalID)
	return nil
}

// ForgetRevokedTokens deletes the revoked ones and reports how many went.
//
// Revoking keeps the row so a token that turns up in a log afterwards can still be named, which
// is worth something for a week and nothing for a year — and until then every revoked token is
// a line in the only list of the live ones. Deliberate rather than swept: what a name is still
// worth is not a question this can answer on somebody's behalf.
//
// Nothing else in the database points at a token, so there is nothing to orphan.
func (s *Store) ForgetRevokedTokens(ctx context.Context, principalID string) (int64, error) {
	res, err := s.writer.ExecContext(ctx,
		`DELETE FROM tokens WHERE principal_id = ? AND revoked_at IS NOT NULL`, principalID)
	if err != nil {
		return 0, fmt.Errorf("forget revoked tokens: %w", err)
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		s.changed(principalID)
	}
	return n, nil
}

// AuthenticateToken resolves a presented value, raw or nonced.
//
// One refusal for every way of being wrong — missing, unknown, expired, revoked, or a nonce out
// of the window — because the difference tells whoever is guessing which half they got right.
func (s *Store) AuthenticateToken(ctx context.Context, presented string) (*Token, error) {
	now := s.Now()

	if strings.HasPrefix(presented, NoncedPrefix) {
		return s.authenticateNonced(ctx, presented, now)
	}
	if !strings.HasPrefix(presented, TokenPrefix) {
		return nil, ErrNotFound
	}
	return s.tokenByKey(ctx, tokenKey(presented), now)
}

// NonceRefusal explains a nonced value's own shape, for the log and for nothing else.
//
// Clock skew is why this exists: a caller five minutes out fails every request, and a reply
// saying "unknown token" sends somebody to audit a token that is fine.
type NonceRefusal struct {
	ID     string
	Reason string
}

func (s *Store) authenticateNonced(ctx context.Context, presented string, now time.Time) (*Token, error) {
	parts := strings.Split(strings.TrimPrefix(presented, NoncedPrefix), NonceSep)
	if len(parts) != 3 {
		return nil, noncedErr("", "it is not <nonce>.<id>.<digest>")
	}
	nonce, id, digest := parts[0], parts[1], parts[2]

	// Parsed strictly as digits, which is what keeps the hashed base unambiguous.
	secs, err := strconv.ParseInt(nonce, 10, 64)
	if err != nil {
		return nil, noncedErr(id, "the nonce is not a whole number of seconds")
	}
	at := time.Unix(secs, 0).UTC()
	if skew := at.Sub(now); skew > NonceWindow || skew < -NonceWindow {
		return nil, noncedErr(id, fmt.Sprintf(
			"the nonce is %s from now, outside the %s window; check the clock on the caller",
			skew.Round(time.Second).Abs(), NonceWindow))
	}

	var key []byte
	err = s.reader.QueryRowContext(ctx, `SELECT secret_hash FROM tokens WHERE id = ?`, id).Scan(&key)
	if errors.Is(err, sql.ErrNoRows) {
		// Nothing is said about whether the id exists: this must be no oracle for one.
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	// The key goes last, where a length extension cannot reach it, and the comparison is
	// constant time.
	want := sha256.Sum256([]byte(nonce + NonceSep + id + NonceSep + hex.EncodeToString(key)))
	if subtle.ConstantTimeCompare([]byte(digest), []byte(hex.EncodeToString(want[:]))) != 1 {
		return nil, ErrNotFound
	}
	return s.tokenByKey(ctx, key, now)
}

func noncedErr(id, reason string) error {
	return &noncedRefusal{NonceRefusal{ID: id, Reason: reason}}
}

type noncedRefusal struct{ NonceRefusal }

func (n *noncedRefusal) Error() string { return "not found" }
func (n *noncedRefusal) Unwrap() error { return ErrNotFound }

// AsNonceRefusal reports what was wrong with a nonced value's shape, if that is what failed.
func AsNonceRefusal(err error) (NonceRefusal, bool) {
	var n *noncedRefusal
	if errors.As(err, &n) {
		return n.NonceRefusal, true
	}
	return NonceRefusal{}, false
}

func (s *Store) tokenByKey(ctx context.Context, key []byte, now time.Time) (*Token, error) {
	tok := &Token{}
	var created int64
	var expires, used, revoked sql.NullInt64
	var idle int64
	err := s.reader.QueryRowContext(ctx,
		`SELECT id, principal_id, label, hint, scope, created_at, expires_at, last_used_at, revoked_at,
		        last_ip, last_agent, idle_ttl
		   FROM tokens WHERE secret_hash = ?`, key).
		Scan(&tok.ID, &tok.PrincipalID, &tok.Label, &tok.Hint, &tok.Scope, &created,
			&expires, &used, &revoked, &tok.LastIP, &tok.LastAgent, &idle)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("token: %w", err)
	}
	tok.CreatedAt = time.Unix(created, 0).UTC()
	tok.ExpiresAt = nullTime(expires)
	tok.LastUsedAt = nullTime(used)
	tok.RevokedAt = nullTime(revoked)
	tok.IdleTTL = time.Duration(idle) * time.Second

	if !tok.Live(now) {
		return nil, ErrNotFound
	}
	// Stamping what was seen is the process noticing itself, so it does not mark the database
	// changed and does not schedule a backup.
	seen := seenFrom(ctx)
	s.writer.ExecContext(ctx,
		`UPDATE tokens SET last_used_at = ?, last_ip = ?, last_agent = ? WHERE id = ?`,
		unix(now), seen.IP, seen.Agent, tok.ID)
	tok.LastUsedAt = &now
	tok.LastIP, tok.LastAgent = seen.IP, seen.Agent
	return tok, nil
}

// NoncedValue builds what a caller would put on the wire. The CLI prints one; the tests use it.
func NoncedValue(secretValue string, at time.Time) string {
	key := hex.EncodeToString(tokenKey(secretValue))
	id := key[:12]
	nonce := strconv.FormatInt(at.Unix(), 10)
	sum := sha256.Sum256([]byte(nonce + NonceSep + id + NonceSep + key))
	return NoncedPrefix + nonce + NonceSep + id + NonceSep + hex.EncodeToString(sum[:])
}

// tokenKey is what the database stores: sha256 of the secret.
//
// Not bcrypt. A password is low-entropy and needs a slow hash to survive being guessed; a
// 256-bit random secret cannot be guessed at any speed, and a slow hash on every API request
// would be a rate limiter nobody asked for.
func tokenKey(value string) []byte {
	sum := sha256.Sum256([]byte(value))
	return sum[:]
}

// tokenID names a token in public: the first 12 hex of the key, which is what a nonced value
// carries and what a listing shows.
func tokenID(value string) string { return hex.EncodeToString(tokenKey(value))[:12] }

// isFlatAnd reports whether a scope is an unnested and() of slugs, or a single slug.
func isFlatAnd(n *filter.Node) bool {
	switch n.Op {
	case filter.Leaf:
		return true
	case filter.And:
		for _, a := range n.Args {
			if a.Op != filter.Leaf {
				return false
			}
		}
		return true
	}
	return false
}

func nullTime(v sql.NullInt64) *time.Time {
	if !v.Valid {
		return nil
	}
	at := time.Unix(v.Int64, 0).UTC()
	return &at
}

// Seen is where a request came from, carried on the context so the token read can write it down
// without the store learning what an HTTP request is.
type Seen struct {
	IP    string
	Agent string
}

type seenKey struct{}

// WithSeen puts the caller's address on a context. The API does this once, at the door.
func WithSeen(ctx context.Context, seen Seen) context.Context {
	return context.WithValue(ctx, seenKey{}, seen)
}

func seenFrom(ctx context.Context) Seen {
	seen, _ := ctx.Value(seenKey{}).(Seen)
	if len(seen.Agent) > 200 {
		seen.Agent = seen.Agent[:200]
	}
	return seen
}
