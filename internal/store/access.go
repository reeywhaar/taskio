package store

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"time"
)

// How long agent access lasts.
const (
	// AccessLinkTTL is how long the link shows its token. Long enough to paste it into an agent
	// and for the agent to read it; short enough that the link in a chat's history, a proxy's log
	// or a preview is dead by the time anybody else looks.
	AccessLinkTTL = 5 * time.Minute
	// AccessTokenTTL is how long the token it shows works, from when the link was made. Enough to
	// work with, and not enough to be somebody's problem later.
	AccessTokenTTL = 30 * time.Minute
)

// Access is what an access link hands over: a token, and where it is meant to be used.
type Access struct {
	// Token is the secret itself, which the link is the one place to read.
	Token   string
	TokenID string
	// TokenExpiresAt is when the token stops working; LinkExpiresAt when the link stops showing
	// it.
	TokenExpiresAt time.Time
	LinkExpiresAt  time.Time
	Principal      *Principal
	Project        *Project
	// Group is the part of the project the work is meant for, or nil for the whole of it. The
	// token reaches the whole project either way: a group is a view, and what it asks of an agent
	// is said on the page rather than enforced.
	Group *Group
}

// CreateAccess makes a token for one project, and a link that shows it for AccessLinkTTL.
//
// It returns the link's code, which is stored only as a hash. The token is kept sealed with a
// key the code gives and nothing else does, so the row opens nothing without the link.
//
// Not a change to anybody's content: no backup goes out because somebody let an agent in.
func (s *Store) CreateAccess(ctx context.Context, principalID, projectID, groupID string) (string, *Access, error) {
	project, err := s.ProjectByID(ctx, principalID, projectID)
	if err != nil {
		return "", nil, err
	}
	if project.DeletedAt != nil {
		return "", nil, Gone("That project was deleted.")
	}
	group, err := s.groupIn(ctx, principalID, projectID, groupID)
	if err != nil {
		return "", nil, err
	}

	now := s.Now()
	expires := now.Add(AccessTokenTTL)
	label := "Agent access · " + project.Name
	if group != nil {
		label = "Agent access · " + group.Name
	}
	// A label holds 64 bytes, and a long name is cut short rather than refused, between letters.
	for len(label) > 64 {
		r := []rune(label)
		label = string(r[:len(r)-1])
	}
	tok, value, err := s.mintToken(ctx, principalID, label,
		[]TokenProject{{ProjectID: projectID}}, &expires, 0, true)
	if err != nil {
		return "", nil, err
	}

	code, err := secret()
	if err != nil {
		return "", nil, err
	}
	sealed, err := seal(code, value)
	if err != nil {
		return "", nil, err
	}
	link := now.Add(AccessLinkTTL)
	var gid any
	if group != nil {
		gid = group.ID
	}
	_, err = s.writer.ExecContext(ctx,
		`INSERT INTO access_links (id, principal_id, token_id, project_id, group_id, sealed, created_at, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		accessID(code), principalID, tok.ID, projectID, gid, sealed, unix(now), unix(link))
	if err != nil {
		return "", nil, fmt.Errorf("create access: %w", err)
	}
	// Listed under Settings, so a browser looking at the list is told; a backup is not.
	s.notify(principalID)

	p, err := s.PrincipalByID(ctx, principalID)
	if err != nil {
		return "", nil, err
	}
	return code, &Access{
		Token:          value,
		TokenID:        tok.ID,
		TokenExpiresAt: expires,
		LinkExpiresAt:  link,
		Principal:      p,
		Project:        project,
		Group:          group,
	}, nil
}

// OpenAccess reads what a link hands over, while it still does: not after AccessLinkTTL, and not
// once its token has been revoked.
func (s *Store) OpenAccess(ctx context.Context, code string) (*Access, error) {
	gone := NotFound("That access link has expired, or was never one of ours.")
	var principalID, tokenID, projectID string
	var groupID sql.NullString
	var sealed []byte
	var expires int64
	err := s.reader.QueryRowContext(ctx,
		`SELECT principal_id, token_id, project_id, group_id, sealed, expires_at
		   FROM access_links WHERE id = ? AND expires_at > ?`,
		accessID(code), unix(s.Now())).
		Scan(&principalID, &tokenID, &projectID, &groupID, &sealed, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, gone
	}
	if err != nil {
		return nil, fmt.Errorf("access: %w", err)
	}

	value, err := unseal(code, sealed)
	if err != nil {
		return nil, gone
	}
	tok, err := s.token(ctx, principalID, tokenID)
	if errors.Is(err, ErrNotFound) {
		return nil, gone
	}
	if err != nil {
		return nil, err
	}
	if !tok.Live(s.Now()) {
		return nil, gone
	}
	p, err := s.PrincipalByID(ctx, principalID)
	if err != nil {
		return nil, err
	}
	if p.DisabledAt != nil {
		return nil, gone
	}
	project, err := s.ProjectByID(ctx, principalID, projectID)
	if err != nil {
		return nil, err
	}
	// A group deleted since is a link to the whole project, which is what the token always was.
	group, err := s.groupIn(ctx, principalID, projectID, groupID.String)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	return &Access{
		Token:          value,
		TokenID:        tokenID,
		TokenExpiresAt: *tok.ExpiresAt,
		LinkExpiresAt:  time.Unix(expires, 0).UTC(),
		Principal:      p,
		Project:        project,
		Group:          group,
	}, nil
}

// SweepAccess drops links past showing their token, and the temporary tokens past working:
// deleted once they lapse rather than kept in the list as expired, where there would be one for
// every time somebody let an agent in.
//
// Not a change either: what goes is what was never content, and a backup that still holds a
// lapsed one holds a token that opens nothing.
func (s *Store) SweepAccess(ctx context.Context) (int64, error) {
	now := unix(s.Now())
	links, err := s.writer.ExecContext(ctx, `DELETE FROM access_links WHERE expires_at <= ?`, now)
	if err != nil {
		return 0, err
	}
	tokens, err := s.writer.ExecContext(ctx,
		`DELETE FROM tokens WHERE temporary = 1 AND expires_at <= ?`, now)
	if err != nil {
		return 0, err
	}
	a, _ := links.RowsAffected()
	b, _ := tokens.RowsAffected()
	if b > 0 {
		// Whoever has the token list open sees them go; nobody is sent a backup for it.
		s.notify("")
	}
	return a + b, nil
}

// groupIn is one of a project's groups by id, or nil for none named.
func (s *Store) groupIn(ctx context.Context, principalID, projectID, groupID string) (*Group, error) {
	if groupID == "" {
		return nil, nil
	}
	groups, err := s.Groups(ctx, principalID, projectID)
	if err != nil {
		return nil, err
	}
	for _, g := range groups {
		if g.ID == groupID {
			return g, nil
		}
	}
	return nil, NotFound("There is no such group in that project.")
}

// accessID is what a link's row is found by: a hash of its code, so the table never holds one.
func accessID(code string) string {
	sum := sha256.Sum256([]byte("taskio access id\x00" + code))
	return hex.EncodeToString(sum[:])
}

// sealKey is the key a link's token is sealed with: from the code, and from nothing stored.
func sealKey(code string) []byte {
	sum := sha256.Sum256([]byte("taskio access seal\x00" + code))
	return sum[:]
}

// seal encrypts a token with its link's code, nonce first.
func seal(code, value string) ([]byte, error) {
	aead, err := accessAEAD(code)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return aead.Seal(nonce, nonce, []byte(value), nil), nil
}

func unseal(code string, sealed []byte) (string, error) {
	aead, err := accessAEAD(code)
	if err != nil {
		return "", err
	}
	if len(sealed) < aead.NonceSize() {
		return "", errors.New("access: sealed value too short")
	}
	nonce, body := sealed[:aead.NonceSize()], sealed[aead.NonceSize():]
	out, err := aead.Open(nil, nonce, body, nil)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func accessAEAD(code string) (cipher.AEAD, error) {
	block, err := aes.NewCipher(sealKey(code))
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
