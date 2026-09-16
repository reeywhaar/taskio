package store

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"taskio/internal/ids"
)

// Roles. Two, because a third would need a set of permissions and nobody has wanted one.
const (
	RoleAdmin = "admin"
	RoleUser  = "user"
)

// bcryptCost is 12. The login rate limit exists partly to bound what that costs on an
// unauthenticated endpoint.
//
// A var so tests can lower it, the way the clock is injectable: a suite that signs in a few
// dozen times otherwise spends its whole run inside the hash it is not testing.
var bcryptCost = 12

// SetBcryptCost lowers the work factor. Tests only.
func SetBcryptCost(cost int) {
	bcryptCost = cost
	h, _ := bcrypt.GenerateFromPassword([]byte("decoy"), cost)
	decoyHash = h
}

// passwordMaxBytes is bcrypt's own limit, checked rather than silently cut.
//
// Bytes and not runes, because the limit is on the encoded form and an emoji costs four. A
// longer password would otherwise authenticate against any prefix of itself.
const passwordMaxBytes = 72

// Principal is an account.
type Principal struct {
	ID         string
	Username   string
	Role       string
	CreatedAt  time.Time
	DisabledAt *time.Time
}

func (p *Principal) IsAdmin() bool { return p.Role == RoleAdmin }

// CreatePrincipal makes an account.
func (s *Store) CreatePrincipal(ctx context.Context, username, password, role string) (*Principal, error) {
	username = strings.TrimSpace(username)
	if err := ValidateUsername(username); err != nil {
		return nil, err
	}
	if err := ValidatePassword(password); err != nil {
		return nil, err
	}
	if role != RoleAdmin && role != RoleUser {
		return nil, Invalid("A role is either admin or user.")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return nil, err
	}

	now := s.Now()
	p := &Principal{
		ID:        ids.New(ids.Principal, now.UnixMilli()),
		Username:  username,
		Role:      role,
		CreatedAt: now,
	}
	_, err = s.writer.ExecContext(ctx,
		`INSERT INTO principals (id, username, password_hash, role, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		p.ID, p.Username, string(hash), p.Role, unix(now))
	if err != nil {
		if isUnique(err) {
			return nil, Conflict("That username is taken.")
		}
		return nil, fmt.Errorf("create principal: %w", err)
	}
	s.changed()
	return p, nil
}

// Authenticate checks a password.
//
// The same refusal for a wrong password and a missing account, and a real hash is compared
// against when no account matched, so the two take the same time. Without that, response
// latency alone is a list of which usernames exist.
func (s *Store) Authenticate(ctx context.Context, username, password string) (*Principal, error) {
	var (
		id, hash, role string
		created        int64
		disabled       sql.NullInt64
	)
	err := s.reader.QueryRowContext(ctx,
		`SELECT id, password_hash, role, created_at, disabled_at
		   FROM principals WHERE lower(username) = lower(?)`, username).
		Scan(&id, &hash, &role, &created, &disabled)
	if errors.Is(err, sql.ErrNoRows) {
		bcrypt.CompareHashAndPassword(decoyHash, []byte(password))
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("authenticate: %w", err)
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return nil, ErrNotFound
	}
	if disabled.Valid {
		return nil, ErrNotFound
	}
	return &Principal{
		ID:        id,
		Username:  username,
		Role:      role,
		CreatedAt: time.Unix(created, 0).UTC(),
	}, nil
}

// decoyHash is a real bcrypt hash at the same cost, so a missing account costs what a present
// one does.
var decoyHash = func() []byte {
	h, _ := bcrypt.GenerateFromPassword([]byte("decoy"), bcryptCost)
	return h
}()

// PrincipalByID returns one account.
func (s *Store) PrincipalByID(ctx context.Context, id string) (*Principal, error) {
	var (
		p        Principal
		created  int64
		disabled sql.NullInt64
	)
	err := s.reader.QueryRowContext(ctx,
		`SELECT id, username, role, created_at, disabled_at FROM principals WHERE id = ?`, id).
		Scan(&p.ID, &p.Username, &p.Role, &created, &disabled)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("principal: %w", err)
	}
	p.CreatedAt = time.Unix(created, 0).UTC()
	if disabled.Valid {
		at := time.Unix(disabled.Int64, 0).UTC()
		p.DisabledAt = &at
	}
	return &p, nil
}

// PrincipalNamed finds an account by username, for the command line.
func (s *Store) PrincipalNamed(ctx context.Context, username string) (*Principal, error) {
	var id string
	err := s.reader.QueryRowContext(ctx,
		`SELECT id FROM principals WHERE lower(username) = lower(?)`, username).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return s.PrincipalByID(ctx, id)
}

// Principals lists every account, for the admin screen.
func (s *Store) Principals(ctx context.Context) ([]*Principal, error) {
	rows, err := s.reader.QueryContext(ctx,
		`SELECT id, username, role, created_at FROM principals ORDER BY created_at`)
	if err != nil {
		return nil, fmt.Errorf("list principals: %w", err)
	}
	defer rows.Close()
	out := []*Principal{}
	for rows.Next() {
		p := &Principal{}
		var created int64
		if err := rows.Scan(&p.ID, &p.Username, &p.Role, &created); err != nil {
			return nil, err
		}
		p.CreatedAt = time.Unix(created, 0).UTC()
		out = append(out, p)
	}
	return out, rows.Err()
}

// HasAdmin reports whether the instance has an administrator yet. Nothing else decides whether
// serve prints an invitation at startup.
func (s *Store) HasAdmin(ctx context.Context) (bool, error) {
	var n int
	err := s.reader.QueryRowContext(ctx,
		`SELECT count(*) FROM principals WHERE role = ? AND disabled_at IS NULL`, RoleAdmin).Scan(&n)
	return n > 0, err
}

// SetPassword changes a password and ends the account's other sessions.
//
// The sessions go first. Fail between the two and somebody has been signed out without their
// password changing — visible, harmless, retryable. The other order leaves live sessions behind
// a changed password, which is a security bug rather than an inconvenience.
//
// One database, so this is one transaction and the ordering argument is belt to its braces.
func (s *Store) SetPassword(ctx context.Context, principalID, password string, keepSession []byte) error {
	if err := ValidatePassword(password); err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return err
	}

	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		`DELETE FROM sessions WHERE principal_id = ? AND id_hash <> ?`,
		principalID, keepSession); err != nil {
		return fmt.Errorf("set password: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE principals SET password_hash = ? WHERE id = ?`, string(hash), principalID); err != nil {
		return fmt.Errorf("set password: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.changed()
	return nil
}

// ValidateUsername refuses what cannot be an account name.
func ValidateUsername(username string) error {
	switch {
	case username == "":
		return Invalid("A username is required.")
	case len(username) > 64:
		return Invalid("That username is longer than 64 characters.")
	}
	for _, r := range username {
		if r < 0x20 || r == 0x7f {
			return Invalid("A username cannot contain control characters.")
		}
	}
	return nil
}

// ValidatePassword refuses what bcrypt would silently truncate.
func ValidatePassword(password string) error {
	switch {
	case len(password) < 8:
		return Invalid("A password needs at least 8 characters.")
	case len(password) > passwordMaxBytes:
		return Invalid("That password is longer than %d bytes, which is as much as the hash reads.", passwordMaxBytes)
	}
	return nil
}

// constantTimeEqual compares two byte slices without leaking where they differ.
func constantTimeEqual(a, b []byte) bool { return subtle.ConstantTimeCompare(a, b) == 1 }

func isUnique(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}
