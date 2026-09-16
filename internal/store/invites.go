package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"taskio/internal/ids"
)

// InviteLifetime is how long a link is good for. Single use either way.
const InviteLifetime = 7 * 24 * time.Hour

// Invite is a link that makes one account.
type Invite struct {
	ID        string
	Role      string
	CreatedAt time.Time
	ExpiresAt time.Time
}

// CreateInvite mints a link and returns it with the token, which is readable exactly once.
//
// The table holds token_hash and never the token, so a lost link is reissued rather than
// recovered — the same stance as a session, and for the same reason.
func (s *Store) CreateInvite(ctx context.Context, createdBy, role string) (*Invite, string, error) {
	if role != RoleAdmin && role != RoleUser {
		return nil, "", Invalid("A role is either admin or user.")
	}
	token, err := secret()
	if err != nil {
		return nil, "", err
	}

	now := s.Now()
	inv := &Invite{
		ID:        ids.New(ids.Invite, now.UnixMilli()),
		Role:      role,
		CreatedAt: now,
		ExpiresAt: now.Add(InviteLifetime),
	}
	_, err = s.writer.ExecContext(ctx,
		`INSERT INTO invites (id, token_hash, created_by, role, created_at, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		inv.ID, hashToken(token), createdBy, role, unix(now), unix(inv.ExpiresAt))
	if err != nil {
		return nil, "", fmt.Errorf("create invite: %w", err)
	}
	s.changed()
	return inv, token, nil
}

// InviteByToken returns a live, unaccepted invitation.
//
// It reveals nothing but its own validity, which is what lets the acceptance page tell somebody
// a link is dead before they type a password into it.
func (s *Store) InviteByToken(ctx context.Context, token string) (*Invite, error) {
	var (
		inv              Invite
		created, expires int64
	)
	err := s.reader.QueryRowContext(ctx,
		`SELECT id, role, created_at, expires_at FROM invites
		  WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?`,
		hashToken(token), unix(s.Now())).
		Scan(&inv.ID, &inv.Role, &created, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, NotFound("That invitation has been used or has expired.")
	}
	if err != nil {
		return nil, fmt.Errorf("invite: %w", err)
	}
	inv.CreatedAt = time.Unix(created, 0).UTC()
	inv.ExpiresAt = time.Unix(expires, 0).UTC()
	return &inv, nil
}

// AcceptInvite spends an invitation and makes the account it was for.
//
// The update carries `accepted_at IS NULL`, so two requests racing on one link produce one
// account and one refusal rather than two accounts.
func (s *Store) AcceptInvite(ctx context.Context, token, username, password string) (*Principal, error) {
	inv, err := s.InviteByToken(ctx, token)
	if err != nil {
		return nil, err
	}

	p, err := s.CreatePrincipal(ctx, username, password, inv.Role)
	if err != nil {
		return nil, err
	}

	res, err := s.writer.ExecContext(ctx,
		`UPDATE invites SET accepted_at = ?, principal_id = ?
		  WHERE id = ? AND accepted_at IS NULL`,
		unix(s.Now()), p.ID, inv.ID)
	if err != nil {
		return nil, fmt.Errorf("accept invite: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		// Somebody else spent the link between the read and the write. The account they made
		// is theirs; this one is not wanted.
		s.writer.ExecContext(ctx, `DELETE FROM principals WHERE id = ?`, p.ID)
		return nil, Conflict("That invitation has just been used.")
	}
	return p, nil
}

// SweepInvites collects links nobody used.
func (s *Store) SweepInvites(ctx context.Context) (int64, error) {
	res, err := s.writer.ExecContext(ctx,
		`DELETE FROM invites WHERE accepted_at IS NULL AND expires_at <= ?`, unix(s.Now()))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// secret is 32 random bytes as base64url: a session cookie, an invitation token, an API token.
func secret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// Secret is the same value for callers outside this package that need one.
func Secret() (string, error) { return secret() }
