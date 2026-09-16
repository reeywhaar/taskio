package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// A recovery code is eight characters of Crockford base32, read off one screen and typed into
// another.
//
// Forty bits is not a key and does not need to be: it is bounded to five attempts, expires in
// fifteen minutes, and authorises nothing but the address it went to.
const (
	RecoveryCodeLen  = 8
	RecoveryLifetime = 15 * time.Minute
	RecoveryAttempts = 5
)

// RecoveryEmail is the proved address on an account, or "".
func (s *Store) RecoveryEmail(ctx context.Context, principalID string) (string, error) {
	var email string
	err := s.reader.QueryRowContext(ctx,
		`SELECT email FROM user_recovery WHERE principal_id = ?`, principalID).Scan(&email)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return email, err
}

// StartRecovery mints a code for an address and returns it, to be sent.
//
// The pending row is written before the send, because the code has to exist before it travels —
// and a send that fails drops it again, or the page says it is waiting on a code that never
// left.
//
// Attempts are replaced, never accumulated: starting again is what somebody does when the mail
// did not arrive, and two live codes for one account is two chances at the same guess.
func (s *Store) StartRecovery(ctx context.Context, principalID, email string) (string, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	if !strings.Contains(email, "@") || len(email) > 254 {
		return "", Invalid("That does not look like an email address.")
	}
	code, err := recoveryCode()
	if err != nil {
		return "", err
	}
	now := s.Now()
	_, err = s.writer.ExecContext(ctx,
		`INSERT INTO recovery_pending (principal_id, email, code_hash, created_at, expires_at, attempts)
		 VALUES (?, ?, ?, ?, ?, 0)
		 ON CONFLICT (principal_id) DO UPDATE SET
		   email = excluded.email, code_hash = excluded.code_hash,
		   created_at = excluded.created_at, expires_at = excluded.expires_at, attempts = 0`,
		principalID, email, hashToken(code), unix(now), unix(now.Add(RecoveryLifetime)))
	if err != nil {
		return "", fmt.Errorf("start recovery: %w", err)
	}
	return code, nil
}

// DropRecovery throws an attempt away.
//
// Its own method rather than a flag on the one that forgets everything: a failed change must
// leave the address that already worked.
func (s *Store) DropRecovery(ctx context.Context, principalID string) error {
	_, err := s.writer.ExecContext(ctx,
		`DELETE FROM recovery_pending WHERE principal_id = ?`, principalID)
	return err
}

// ConfirmRecovery proves an address and moves it across.
//
// Two tables rather than a proved column: a nullable flag is one forgotten WHERE clause away
// from an unproved address being treated as proved.
func (s *Store) ConfirmRecovery(ctx context.Context, principalID, code string) error {
	code = NormalizeRecoveryCode(code)

	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var (
		email    string
		hash     []byte
		expires  int64
		attempts int
	)
	err = tx.QueryRowContext(ctx,
		`SELECT email, code_hash, expires_at, attempts FROM recovery_pending WHERE principal_id = ?`,
		principalID).Scan(&email, &hash, &expires, &attempts)
	if errors.Is(err, sql.ErrNoRows) {
		return NotFound("There is no code waiting. Ask for another.")
	}
	if err != nil {
		return err
	}
	if time.Unix(expires, 0).Before(s.Now()) {
		return NotFound("That code has expired. Ask for another.")
	}

	if !constantTimeEqual(hash, hashToken(code)) {
		attempts++
		if attempts >= RecoveryAttempts {
			// Thrown away rather than locked: a lockout is a state somebody has to wait out,
			// and starting again is faster and no weaker.
			if _, err := tx.ExecContext(ctx,
				`DELETE FROM recovery_pending WHERE principal_id = ?`, principalID); err != nil {
				return err
			}
			if err := tx.Commit(); err != nil {
				return err
			}
			return Invalid("That code is wrong, and there have been too many tries. Ask for another.")
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE recovery_pending SET attempts = ? WHERE principal_id = ?`, attempts, principalID); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		return Invalid("That code is wrong.")
	}

	// One address, one account, held by whoever proved it last: whoever can read that inbox
	// today is who recovery through it would actually reach.
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM user_recovery WHERE lower(email) = lower(?)`, email); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO user_recovery (principal_id, email, confirmed_at) VALUES (?, ?, ?)
		 ON CONFLICT (principal_id) DO UPDATE SET email = excluded.email, confirmed_at = excluded.confirmed_at`,
		principalID, email, unix(s.Now())); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM recovery_pending WHERE principal_id = ?`, principalID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.changed(principalID)
	return nil
}

// ForgetRecovery removes a proved address.
func (s *Store) ForgetRecovery(ctx context.Context, principalID string) error {
	if _, err := s.writer.ExecContext(ctx,
		`DELETE FROM user_recovery WHERE principal_id = ?`, principalID); err != nil {
		return err
	}
	s.changed(principalID)
	return nil
}

// NormalizeRecoveryCode is forgiving about case, spaces, and the letters the alphabet leaves
// out — the same substitutions a task id gets, for the same reason.
func NormalizeRecoveryCode(code string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(code) {
		switch r {
		case ' ', '-', '\t':
		case 'i', 'l':
			b.WriteByte('1')
		case 'o':
			b.WriteByte('0')
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func recoveryCode() (string, error) {
	const alphabet = "0123456789abcdefghjkmnpqrstvwxyz"
	b := make([]byte, RecoveryCodeLen)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b), nil
}
