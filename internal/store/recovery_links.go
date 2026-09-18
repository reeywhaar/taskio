package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"taskio/internal/ids"
)

// This file is the recovery link. recovery.go is the recovery address — the inbox an account
// has proved it can read. The two meet in one place: a forgotten password looks up the address
// and sends a link to it.

// RecoveryLinkLifetime is how long a link stays usable. A week, like an invitation, and single
// use either way.
const RecoveryLinkLifetime = 7 * 24 * time.Hour

// RecoveryLink is one issued way back into an account.
//
// It keeps its row after it is spent. That row is the record of how somebody got back in and
// who let them, which is the first thing anybody looking into a stolen account wants.
type RecoveryLink struct {
	ID          string
	PrincipalID string
	// CreatedBy is the administrator who issued it, empty when the account asked for itself.
	CreatedBy string
	CreatedAt time.Time
	ExpiresAt time.Time
	// UsedAt is zero while the link is outstanding.
	UsedAt time.Time
	// VoidedAt is when a different link for this account was spent instead. See UseRecoveryLink.
	VoidedAt time.Time
}

// Used reports whether this link has already set a password.
func (l *RecoveryLink) Used() bool { return !l.UsedAt.IsZero() }

// Voided reports whether another link for the same account was spent while this one was out.
func (l *RecoveryLink) Voided() bool { return !l.VoidedAt.IsZero() }

// Expired reports whether this link has lapsed.
func (l *RecoveryLink) Expired(now time.Time) bool { return now.After(l.ExpiresAt) }

// Usable reports whether this link can still set a password.
func (l *RecoveryLink) Usable(now time.Time) bool {
	return !l.Used() && !l.Voided() && !l.Expired(now)
}

// CreateRecoveryLink mints a way back into an account and returns it with its token.
//
// createdBy is the administrator who asked, or empty when the account asked for itself.
//
// The token is returned exactly once, here. What is stored is its hash, so a lost link is
// reissued rather than recovered — the same stance as a session and an invitation.
//
// This changes nothing about the account. No session ends, no password moves, and nobody is
// told: somebody who still knows their password carries on as though this never happened, which
// is what makes it safe for an administrator to hand one over unprompted.
func (s *Store) CreateRecoveryLink(ctx context.Context, principalID, createdBy string) (*RecoveryLink, string, error) {
	// Read first, so a link cannot be minted against an id that is not an account — the row
	// would insert against the foreign key and then sit there naming nothing.
	p, err := s.PrincipalByID(ctx, principalID)
	if err != nil {
		return nil, "", err
	}
	// A disabled account cannot sign in whatever its password is, so a link into it leads
	// nowhere. Refusing here says so, rather than letting somebody set a password and find out
	// at the login form.
	if p.DisabledAt != nil {
		return nil, "", Conflict("That account is disabled, so a new password would not let anybody in.")
	}

	token, err := secret()
	if err != nil {
		return nil, "", err
	}

	now := s.Now()
	link := &RecoveryLink{
		ID:          ids.New(ids.Recovery, now.UnixMilli()),
		PrincipalID: principalID,
		CreatedBy:   createdBy,
		CreatedAt:   now,
		ExpiresAt:   now.Add(RecoveryLinkLifetime),
	}

	// NULL rather than the empty string when nobody issued it: the column is a reference, and
	// "" is not an account.
	var author any
	if createdBy != "" {
		author = createdBy
	}
	if _, err := s.writer.ExecContext(ctx,
		`INSERT INTO recovery_links (id, token_hash, principal_id, created_by, created_at, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		link.ID, hashToken(token), link.PrincipalID, author,
		unix(link.CreatedAt), unix(link.ExpiresAt)); err != nil {
		return nil, "", fmt.Errorf("create recovery link: %w", err)
	}
	return link, token, nil
}

const recoveryLinkColumns = `id, principal_id, created_by, created_at, expires_at, used_at, voided_at`

func scanRecoveryLink(row interface{ Scan(...any) error }) (*RecoveryLink, error) {
	var (
		l                RecoveryLink
		createdBy        sql.NullString
		created, expires int64
		used, voided     sql.NullInt64
	)
	if err := row.Scan(&l.ID, &l.PrincipalID, &createdBy, &created, &expires, &used, &voided); err != nil {
		return nil, err
	}
	l.CreatedBy = createdBy.String
	l.CreatedAt = time.Unix(created, 0).UTC()
	l.ExpiresAt = time.Unix(expires, 0).UTC()
	if used.Valid {
		l.UsedAt = time.Unix(used.Int64, 0).UTC()
	}
	if voided.Valid {
		l.VoidedAt = time.Unix(voided.Int64, 0).UTC()
	}
	return &l, nil
}

// RecoveryLinkByToken looks a link up by the token in it.
//
// Spent, voided and expired links come back like usable ones. The page has to tell those apart
// to say anything useful — set a password, sign in with the one you already set, use the newer
// link, or ask again — and which state a token is in is not a secret from whoever holds it.
func (s *Store) RecoveryLinkByToken(ctx context.Context, token string) (*RecoveryLink, error) {
	link, err := scanRecoveryLink(s.reader.QueryRowContext(ctx,
		`SELECT `+recoveryLinkColumns+` FROM recovery_links WHERE token_hash = ?`, hashToken(token)))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, NotFound("That recovery link is not one of ours.")
	}
	if err != nil {
		return nil, fmt.Errorf("recovery link: %w", err)
	}
	return link, nil
}

// UseRecoveryLink spends a link on a new password, and returns the account it let into.
//
// One transaction, so a token cannot set two passwords however many times it is submitted, and
// a password cannot move without the link that moved it being stamped.
//
// Three things happen together, and each is the point of one of the others:
//
//   - the password is replaced, which is what somebody came here for;
//   - every session for the account ends, because the likeliest reason to be here at all is
//     that somebody else has one, and leaving them signed in would make the whole exercise
//     decorative. Unlike changing a password from inside the application there is no session to
//     keep — whoever did this is at a form, not signed in;
//   - every other outstanding link for the account is voided, because from the moment one is
//     spent the rest cannot be told apart from stolen ones, and the account has just
//     demonstrated it does not need either.
func (s *Store) UseRecoveryLink(ctx context.Context, token, password string) (*Principal, error) {
	// Before the transaction and before bcrypt: hashing at cost 12 on an endpoint anybody can
	// reach is a reason not to reach it with nonsense.
	if err := ValidatePassword(password); err != nil {
		return nil, err
	}

	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	link, err := scanRecoveryLink(tx.QueryRowContext(ctx,
		`SELECT `+recoveryLinkColumns+` FROM recovery_links WHERE token_hash = ?`, hashToken(token)))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, NotFound("That recovery link is not one of ours.")
	}
	if err != nil {
		return nil, fmt.Errorf("recovery link: %w", err)
	}

	now := s.Now()
	switch {
	case link.Used():
		return nil, Conflict("That recovery link has already been used.")
	case link.Voided():
		return nil, Conflict("That recovery link was replaced when a newer one was used.")
	case link.Expired(now):
		return nil, Invalid("That recovery link expired on %s. Ask for another.",
			link.ExpiresAt.Format(time.DateOnly))
	}

	p, err := s.PrincipalByID(ctx, link.PrincipalID)
	if err != nil {
		return nil, err
	}
	// Checked again here rather than only at issue: an account can be disabled in the week
	// between a link being handed out and being opened.
	if p.DisabledAt != nil {
		return nil, Conflict("That account is disabled, so a new password would not let anybody in.")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE principals SET password_hash = ? WHERE id = ?`, string(hash), p.ID); err != nil {
		return nil, fmt.Errorf("use recovery link: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM sessions WHERE principal_id = ?`, p.ID); err != nil {
		return nil, fmt.Errorf("use recovery link: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE recovery_links SET used_at = ? WHERE id = ?`, unix(now), link.ID); err != nil {
		return nil, fmt.Errorf("use recovery link: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE recovery_links SET voided_at = ?
		  WHERE principal_id = ? AND id <> ? AND used_at IS NULL AND voided_at IS NULL`,
		unix(now), p.ID, link.ID); err != nil {
		return nil, fmt.Errorf("use recovery link: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("use recovery link: %w", err)
	}
	return p, nil
}

// VoidRecoveryLink takes a link out of use without anybody having spent it.
//
// For the one case where a link exists and its only copy does not: a mail that failed to leave.
// Left alone that row would sit there outstanding, voiding the account's real link the moment
// somebody used it — and doing nothing for anybody, because the token went nowhere.
//
// Silent about a link that is already used or voided: this is called to reach a state, not to
// perform an operation, and the state is already reached.
func (s *Store) VoidRecoveryLink(ctx context.Context, id string) error {
	_, err := s.writer.ExecContext(ctx,
		`UPDATE recovery_links SET voided_at = ?
		  WHERE id = ? AND used_at IS NULL AND voided_at IS NULL`, unix(s.Now()), id)
	if err != nil {
		return fmt.Errorf("void recovery link: %w", err)
	}
	return nil
}

// PrincipalByRecoveryEmail finds the account that has proved it can read an address.
//
// Only a confirmed address counts, which is what user_recovery holds — a pending one is a claim
// and mailing a way into an account to a claim is the hole this feature would otherwise be.
func (s *Store) PrincipalByRecoveryEmail(ctx context.Context, email string) (*Principal, error) {
	var id string
	err := s.reader.QueryRowContext(ctx,
		`SELECT principal_id FROM user_recovery WHERE lower(email) = ?`,
		strings.ToLower(strings.TrimSpace(email))).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, NotFound("No account has proved that address.")
	}
	if err != nil {
		return nil, fmt.Errorf("recovery email: %w", err)
	}
	return s.PrincipalByID(ctx, id)
}

// SweepRecoveryLinks collects links nobody used.
//
// Spent ones stay: they are the record of how somebody got back in. What goes is the ones that
// lapsed outstanding, which record nothing anybody asked about.
func (s *Store) SweepRecoveryLinks(ctx context.Context) (int64, error) {
	res, err := s.writer.ExecContext(ctx,
		`DELETE FROM recovery_links
		  WHERE used_at IS NULL AND expires_at <= ?`, unix(s.Now()))
	if err != nil {
		return 0, fmt.Errorf("sweep recovery links: %w", err)
	}
	return res.RowsAffected()
}
