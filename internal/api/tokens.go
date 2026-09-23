package api

import (
	"net/http"
	"strings"
	"time"

	"taskio/internal/store"
)

type tokenBody struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Hint  string `json:"hint"`
	// Scope is its one row's scope, for a token reaching one project — which is every token
	// minted before projects. Empty for one reaching several: read Projects.
	Scope string `json:"scope"`
	// Projects is what it reaches, one row per project.
	Projects   []tokenRow `json:"projects"`
	CreatedAt  int64      `json:"created_at"`
	ExpiresAt  *int64     `json:"expires_at"`
	LastUsedAt *int64     `json:"last_used_at"`
	RevokedAt  *int64     `json:"revoked_at"`
	// Where it was last used from, which is the question a token raises: used by what, from
	// where. Empty until it has been used once.
	LastIP    string `json:"last_ip"`
	LastAgent string `json:"last_agent"`
	// IdleSeconds is how long it may go unused before it stops working. 0 is never.
	IdleSeconds int64 `json:"idle_seconds"`
}

// tokenRow is one project a token reaches, and what confines it there.
type tokenRow struct {
	Project string `json:"project"`
	Name    string `json:"name"`
	Scope   string `json:"scope"`
	// Deleted is a project since deleted, which the token still names and is refused on.
	Deleted bool `json:"deleted,omitempty"`
}

// renderToken draws one; projects names the account's projects by id, deleted ones included.
func renderToken(t *store.Token, projects map[string]*store.Project) tokenBody {
	rows := make([]tokenRow, 0, len(t.Projects))
	for _, row := range t.Projects {
		p := projects[row.ProjectID]
		if p == nil {
			continue
		}
		rows = append(rows, tokenRow{Project: p.Slug, Name: p.Name, Scope: row.Scope, Deleted: p.DeletedAt != nil})
	}
	scope := ""
	if len(t.Projects) == 1 {
		scope = t.Projects[0].Scope
	}
	return tokenBody{
		ID:         t.ID,
		Label:      t.Label,
		Hint:       t.Hint,
		Scope:      scope,
		Projects:   rows,
		CreatedAt:  t.CreatedAt.Unix(),
		ExpiresAt:  unixPtr(t.ExpiresAt),
		LastUsedAt: unixPtr(t.LastUsedAt),
		LastIP:     t.LastIP,
		LastAgent:  t.LastAgent,

		IdleSeconds: int64(t.IdleTTL / time.Second),
		RevokedAt:   unixPtr(t.RevokedAt),
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
	projects, err := s.projectsByID(r, list)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	for _, t := range list {
		out = append(out, renderToken(t, projects))
	}
	writeJSON(w, http.StatusOK, map[string]any{"tokens": out})
}

// rowRequest is one project in a mint or an edit.
type rowRequest struct {
	Project string `json:"project"`
	Scope   string `json:"scope"`
}

type createTokenRequest struct {
	Label string `json:"label"`
	// Scope alone is a token for the default project, confined there — minting as it was before
	// projects. Projects says each project and its scope, and takes precedence.
	Scope     string       `json:"scope"`
	Projects  []rowRequest `json:"projects"`
	ExpiresAt *int64       `json:"expires_at"`
	// IdleSeconds retires it after that long unused. 0, or absent, is never.
	IdleSeconds int64 `json:"idle_seconds"`
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
	rows, ok := s.rowsOf(w, r, req.Projects, &req.Scope)
	if !ok {
		return
	}
	tok, secret, err := s.store.CreateToken(r.Context(), principalOf(r).ID, req.Label, rows,
		expires, time.Duration(req.IdleSeconds)*time.Second)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	projects, err := s.projectsByID(r, []*store.Token{tok})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	body := renderToken(tok, projects)
	s.log.Info("token minted", "principal", principalOf(r).ID, "token", tok.ID, "projects", tok.Projects)
	writeJSON(w, http.StatusCreated, map[string]any{"token": body, "secret": secret})
}

type patchTokenRequest struct {
	Label *string `json:"label"`
	// Scope changes the one row of a token that reaches one project. Projects replaces them all.
	Scope    *string       `json:"scope"`
	Projects *[]rowRequest `json:"projects"`
	// ExpiresAt is a unix time, and 0 clears it so the token never expires.
	ExpiresAt *int64 `json:"expires_at"`
	// IdleSeconds retires it after that long unused. 0 is never.
	IdleSeconds *int64 `json:"idle_seconds"`
}

// patchToken changes what a token is called, what it reaches and when it stops working,
// without reissuing it. Absent leaves a field alone.
//
// The value in somebody's config does not change, which is the whole point: narrowing an
// agent's reach otherwise means revoking, minting, and finding every place the old one was
// pasted. Logged like minting, because it is the same question asked later — what this
// credential can reach, and for how long.
func (s *Server) patchToken(w http.ResponseWriter, r *http.Request) {
	var req patchTokenRequest
	if !decode(w, r, &req) {
		return
	}
	change := store.TokenChange{Label: req.Label}
	if req.Projects != nil || req.Scope != nil {
		var asked []rowRequest
		if req.Projects != nil {
			asked = *req.Projects
		} else {
			var ok bool
			if asked, ok = s.onlyRow(w, r, *req.Scope); !ok {
				return
			}
		}
		rows, ok := s.rowsOf(w, r, asked, nil)
		if !ok {
			return
		}
		change.Projects = &rows
	}
	if req.ExpiresAt != nil {
		var at time.Time
		if *req.ExpiresAt != 0 {
			at = time.Unix(*req.ExpiresAt, 0).UTC()
		}
		change.Expires = &at
	}
	if req.IdleSeconds != nil {
		idle := time.Duration(*req.IdleSeconds) * time.Second
		change.Idle = &idle
	}
	tok, err := s.store.UpdateToken(r.Context(), principalOf(r).ID, r.PathValue("id"), change)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.log.Info("token changed", "principal", principalOf(r).ID, "token", tok.ID,
		"projects", tok.Projects, "expires", tok.ExpiresAt, "idle", tok.IdleTTL)
	projects, err := s.projectsByID(r, []*store.Token{tok})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, renderToken(tok, projects))
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

// rowsOf turns the projects a mint or an edit names, by slug, into rows. None named, with a
// scope, is a token for the default project confined by that scope — how every token was
// minted before projects, and how the CLI still mints one.
func (s *Server) rowsOf(w http.ResponseWriter, r *http.Request, asked []rowRequest, legacy *string) ([]store.TokenProject, bool) {
	ctx := r.Context()
	principal := principalOf(r).ID
	if len(asked) == 0 && legacy != nil {
		p, err := s.store.DefaultProject(ctx, principal)
		if err != nil {
			s.fail(w, r, err)
			return nil, false
		}
		return []store.TokenProject{{ProjectID: p.ID, Scope: *legacy}}, true
	}
	rows := make([]store.TokenProject, 0, len(asked))
	for _, a := range asked {
		p, err := s.store.ProjectBySlug(ctx, principal, strings.TrimSpace(a.Project))
		if err != nil {
			s.fail(w, r, err)
			return nil, false
		}
		rows = append(rows, store.TokenProject{ProjectID: p.ID, Scope: a.Scope})
	}
	return rows, true
}

// onlyRow is a scope alone, applied to a token reaching exactly one project. One reaching
// several has no one row it could mean, and is told to send its projects.
func (s *Server) onlyRow(w http.ResponseWriter, r *http.Request, scope string) ([]rowRequest, bool) {
	tokens, err := s.store.Tokens(r.Context(), principalOf(r).ID)
	if err != nil {
		s.fail(w, r, err)
		return nil, false
	}
	for _, t := range tokens {
		if t.ID != r.PathValue("id") {
			continue
		}
		if len(t.Projects) != 1 {
			refuse(w, http.StatusBadRequest, CodeInvalid,
				"This token reaches several projects, so a scope alone could mean any of them. Send projects.")
			return nil, false
		}
		p, err := s.store.ProjectByID(r.Context(), principalOf(r).ID, t.Projects[0].ProjectID)
		if err != nil {
			s.fail(w, r, err)
			return nil, false
		}
		return []rowRequest{{Project: p.Slug, Scope: scope}}, true
	}
	s.fail(w, r, store.NotFound("There is no such token."))
	return nil, false
}

// projectsByID loads every project the tokens name, deleted ones included.
func (s *Server) projectsByID(r *http.Request, tokens []*store.Token) (map[string]*store.Project, error) {
	out := map[string]*store.Project{}
	for _, t := range tokens {
		for _, row := range t.Projects {
			if out[row.ProjectID] != nil {
				continue
			}
			p, err := s.store.ProjectByID(r.Context(), principalOf(r).ID, row.ProjectID)
			if err != nil {
				return nil, err
			}
			out[row.ProjectID] = p
		}
	}
	return out, nil
}
