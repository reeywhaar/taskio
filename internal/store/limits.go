package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// Defaults for the two numbers an operator sets from the admin page.
//
// In the database rather than the environment: an operator who finds 10MB too small finds out
// when somebody cannot paste a screenshot, and the fix should be a form field rather than a
// redeploy with a restart in the middle of their afternoon.
const (
	DefaultAssetMax   = 10 << 20
	DefaultAssetQuota = 1 << 30
)

// Limits is how large one image may be and how much one account may keep.
type Limits struct {
	AssetMaxBytes     int64
	AccountQuotaBytes int64
}

// Limits reads the instance's, or the defaults when nobody has set any.
func (s *Store) Limits(ctx context.Context) (Limits, error) {
	l := Limits{AssetMaxBytes: DefaultAssetMax, AccountQuotaBytes: DefaultAssetQuota}
	err := s.reader.QueryRowContext(ctx,
		`SELECT asset_max_bytes, account_quota_bytes FROM limits WHERE singleton = 1`).
		Scan(&l.AssetMaxBytes, &l.AccountQuotaBytes)
	if errors.Is(err, sql.ErrNoRows) {
		return l, nil
	}
	if err != nil {
		return l, fmt.Errorf("limits: %w", err)
	}
	return l, nil
}

// SetLimits writes them.
//
// Lowering the quota below what an account already holds deletes nothing: existing assets stay
// and stay served, and what stops is uploading. The other reading — that lowering a number
// destroys data — is not one anybody would want to discover by trying it.
func (s *Store) SetLimits(ctx context.Context, l Limits) error {
	if l.AssetMaxBytes < 1 || l.AccountQuotaBytes < 1 {
		return Invalid("Both limits are a number of bytes above zero.")
	}
	if l.AssetMaxBytes > l.AccountQuotaBytes {
		return Invalid("One image cannot be allowed to be larger than a whole account's quota.")
	}
	_, err := s.writer.ExecContext(ctx,
		`INSERT INTO limits (singleton, asset_max_bytes, account_quota_bytes) VALUES (1, ?, ?)
		 ON CONFLICT (singleton) DO UPDATE SET asset_max_bytes = ?, account_quota_bytes = ?`,
		l.AssetMaxBytes, l.AccountQuotaBytes, l.AssetMaxBytes, l.AccountQuotaBytes)
	if err != nil {
		return fmt.Errorf("set limits: %w", err)
	}
	s.changedAll()
	return nil
}
