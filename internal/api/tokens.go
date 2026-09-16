package api

import (
	"net/http"
	"strings"
	"time"

	"taskio/internal/store"
)

type tokenBody struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	Hint       string `json:"hint"`
	Scope      string `json:"scope"`
	CreatedAt  int64  `json:"created_at"`
	ExpiresAt  *int64 `json:"expires_at"`
	LastUsedAt *int64 `json:"last_used_at"`
	RevokedAt  *int64 `json:"revoked_at"`
}

func renderToken(t *store.Token) tokenBody {
	return tokenBody{
		ID:         t.ID,
		Label:      t.Label,
		Hint:       t.Hint,
		Scope:      t.Scope,
		CreatedAt:  t.CreatedAt.Unix(),
		ExpiresAt:  unixPtr(t.ExpiresAt),
		LastUsedAt: unixPtr(t.LastUsedAt),
		RevokedAt:  unixPtr(t.RevokedAt),
	}
}

func unixPtr(t *time.Time) *int64 {
	if t == nil {
		return nil
	}
	v := t.Unix()
	return &v
}

func (s *Server) listTokens(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.Tokens(r.Context(), principalOf(r).ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	out := make([]tokenBody, 0, len(list))
	for _, t := range list {
		out = append(out, renderToken(t))
	}
	writeJSON(w, http.StatusOK, map[string]any{"tokens": out})
}

type createTokenRequest struct {
	Label     string `json:"label"`
	Scope     string `json:"scope"`
	ExpiresAt *int64 `json:"expires_at"`
}

// createToken mints one. The secret is in this response and nowhere else, ever.
func (s *Server) createToken(w http.ResponseWriter, r *http.Request) {
	var req createTokenRequest
	if !decode(w, r, &req) {
		return
	}
	var expires *time.Time
	if req.ExpiresAt != nil {
		at := time.Unix(*req.ExpiresAt, 0).UTC()
		expires = &at
	}
	tok, secret, err := s.store.CreateToken(r.Context(), principalOf(r).ID, req.Label, req.Scope, expires)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	body := renderToken(tok)
	s.log.Info("token minted", "principal", principalOf(r).ID, "token", tok.ID, "scope", tok.Scope)
	writeJSON(w, http.StatusCreated, map[string]any{"token": body, "secret": secret})
}

type tokenScopeRequest struct {
	Scope string `json:"scope"`
}

// patchToken changes a token's scope without reissuing it.
//
// The value in somebody's config does not change, which is the whole point: narrowing an
// agent's reach otherwise means revoking, minting, and finding every place the old one was
// pasted. Logged like minting, because it is the same question asked later — what this
// credential can reach.
func (s *Server) patchToken(w http.ResponseWriter, r *http.Request) {
	var req tokenScopeRequest
	if !decode(w, r, &req) {
		return
	}
	tok, err := s.store.SetTokenScope(r.Context(), principalOf(r).ID, r.PathValue("id"), req.Scope)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.log.Info("token scope changed", "principal", principalOf(r).ID, "token", tok.ID, "scope", tok.Scope)
	writeJSON(w, http.StatusOK, renderToken(tok))
}

func (s *Server) revokeToken(w http.ResponseWriter, r *http.Request) {
	if err := s.store.RevokeToken(r.Context(), principalOf(r).ID, r.PathValue("id")); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// forgetRevokedTokens clears the revoked rows out of the listing.
//
// A route of its own rather than a flag on the listing: it is the one thing here that loses
// something, and DELETE /api/tokens/{id} could never mean it — an id is twelve hex characters,
// so nothing can be named "revoked".
func (s *Server) forgetRevokedTokens(w http.ResponseWriter, r *http.Request) {
	n, err := s.store.ForgetRevokedTokens(r.Context(), principalOf(r).ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.log.Info("revoked tokens forgotten", "principal", principalOf(r).ID, "count", n)
	writeJSON(w, http.StatusOK, map[string]any{"forgotten": n})
}

// bearer is the presented credential, from the header or from ?token= for a nonced value.
//
// A raw token is header-only; a nonced one is also accepted in the URL, and that asymmetry is
// the whole point — a value useless in five minutes is safe somewhere a permanent one is not.
func bearer(r *http.Request) string {
	if h := r.Header.Get("Authorization"); h != "" {
		if v, ok := strings.CutPrefix(h, "Bearer "); ok {
			return strings.TrimSpace(v)
		}
		return ""
	}
	if v := r.URL.Query().Get("token"); strings.HasPrefix(v, store.NoncedPrefix) {
		return v
	}
	return ""
}
