package api

import (
	"errors"
	"net/http"
	"strings"

	"taskio/internal/session"
	"taskio/internal/store"
)

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// login checks a password and issues a cookie.
//
// Two buckets, with two different jobs. The global one bounds bcrypt, which at cost 12 on an
// unauthenticated endpoint is a CPU exhaustion vector before it is an authentication one. The
// per-username one stops somebody working through a password list against one account, which
// the global limit alone would only make them share with everybody else.
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if !decode(w, r, &req) {
		return
	}
	if !s.loginAll.allow("") {
		refuse(w, http.StatusTooManyRequests, CodeRateLimited, "Too many sign-in attempts. Wait a minute.")
		return
	}
	if !s.loginUser.allow(strings.ToLower(req.Username)) {
		refuse(w, http.StatusTooManyRequests, CodeRateLimited, "Too many sign-in attempts for that account. Wait a minute.")
		return
	}

	p, err := s.store.Authenticate(r.Context(), req.Username, req.Password)
	if err != nil {
		// One refusal for a wrong password and a missing account.
		refuse(w, http.StatusUnauthorized, CodeUnauthenticated, "That username and password do not match.")
		return
	}
	if err := s.sessions.Issue(r.Context(), w, r, p.ID); err != nil {
		s.fail(w, r, err)
		return
	}
	s.log.Info("signed in", "principal", p.ID)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if err := s.sessions.Revoke(r.Context(), w, r); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	p := principalOf(r)
	writeJSON(w, http.StatusOK, map[string]any{
		"id":         p.ID,
		"username":   p.Username,
		"role":       p.Role,
		"created_at": p.CreatedAt.Unix(),
	})
}

// getInvite tells the acceptance page whether a link is live before somebody types a password
// into it. It reveals nothing but its own validity.
func (s *Server) getInvite(w http.ResponseWriter, r *http.Request) {
	inv, err := s.store.InviteByToken(r.Context(), r.PathValue("token"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"role":       inv.Role,
		"expires_at": inv.ExpiresAt.Unix(),
	})
}

type acceptRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// acceptInvite spends a link and signs the new account in.
//
// Signing in immediately, because being shown a login form straight afterwards is asking
// somebody to prove something they just proved.
func (s *Server) acceptInvite(w http.ResponseWriter, r *http.Request) {
	var req acceptRequest
	if !decode(w, r, &req) {
		return
	}
	p, err := s.store.AcceptInvite(r.Context(), r.PathValue("token"), req.Username, req.Password)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.sessions.Issue(r.Context(), w, r, p.ID); err != nil {
		s.fail(w, r, err)
		return
	}
	s.log.Info("account created", "principal", p.ID, "role", p.Role)
	w.WriteHeader(http.StatusNoContent)
}

// requireSession admits a request that carries a live session, and nothing else.
//
// Applied at registration rather than inside a handler, so a handler cannot forget to check:
// one registered without this is visibly registered without it.
func (s *Server) requireSession(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sess, err := s.sessions.Resolve(r.Context(), w, r)
		if errors.Is(err, session.ErrNoSession) {
			// Never a redirect: a 302 to an HTML page is the least useful thing a fetch can
			// receive. The island reads this and navigates itself.
			refuse(w, http.StatusUnauthorized, CodeUnauthenticated, "Sign in first.")
			return
		}
		if err != nil {
			s.fail(w, r, err)
			return
		}
		p, err := s.store.PrincipalByID(r.Context(), sess.PrincipalID)
		if err != nil || p.DisabledAt != nil {
			s.sessions.Clear(w)
			refuse(w, http.StatusUnauthorized, CodeUnauthenticated, "Sign in first.")
			return
		}
		next.ServeHTTP(w, withPrincipal(r, p, sess))
	})
}

// requireAuth admits a session or a token.
//
// The two axes are decided at registration: a route registered with this is one an agent may
// reach, and one registered with requireSession is one only a browser may.
//
// A request carrying Authorization is a token request and the cookie is ignored entirely — one
// identity per request, decided by one rule, before any handler runs. Without that, a
// cross-site post from a page somebody is signed in to could be reclassified by a stray header.
func (s *Server) requireAuth(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		presented := bearer(r)
		if presented == "" && r.Header.Get("Authorization") == "" {
			s.requireSession(next).ServeHTTP(w, r)
			return
		}
		if !s.tokenAuth.allow(clientOf(r)) {
			refuse(w, http.StatusTooManyRequests, CodeRateLimited, "Too many attempts. Wait a minute.")
			return
		}

		// Where it was used from, written down by the read that proves it.
		ctx := store.WithSeen(r.Context(), store.Seen{
			IP:    clientOf(r),
			Agent: r.UserAgent(),
		})
		tok, err := s.store.AuthenticateToken(ctx, presented)
		if err != nil {
			if refusal, ok := store.AsNonceRefusal(err); ok {
				// The log says which, for the value's own shape and timestamp only. It never
				// reads the token table, so it is no oracle for whether an id exists.
				s.log.Warn("a nonced token was refused", "id", refusal.ID, "reason", refusal.Reason)
			}
			refuse(w, http.StatusUnauthorized, CodeUnauthenticated, "That token is not one this accepts.")
			return
		}

		p, err := s.store.PrincipalByID(r.Context(), tok.PrincipalID)
		if err != nil || p.DisabledAt != nil {
			refuse(w, http.StatusUnauthorized, CodeUnauthenticated, "That token is not one this accepts.")
			return
		}
		scope, err := tok.ScopeFilter()
		if err != nil {
			s.fail(w, r, err)
			return
		}

		r = r.WithContext(contextWith(contextWith(r.Context(), ctxPrincipal, p), ctxScope, scope))
		next.ServeHTTP(w, r)
	})
}

// clientOf names who to rate limit, which for a token is where it came from.
func clientOf(r *http.Request) string {
	host, _, ok := strings.Cut(r.RemoteAddr, ":")
	if !ok {
		return r.RemoteAddr
	}
	return host
}

// requireAdmin is requireSession and one more question.
func (s *Server) requireAdmin(next http.HandlerFunc) http.Handler {
	return s.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if !principalOf(r).IsAdmin() {
			refuse(w, http.StatusForbidden, CodeForbidden, "That is an administrator's.")
			return
		}
		next(w, r)
	})
}

type ctxKey int

const (
	ctxPrincipal ctxKey = iota
	ctxSession
	ctxScope
)

func withPrincipal(r *http.Request, p *store.Principal, sess *store.Session) *http.Request {
	ctx := r.Context()
	ctx = contextWith(ctx, ctxPrincipal, p)
	ctx = contextWith(ctx, ctxSession, sess)
	return r.WithContext(ctx)
}

func principalOf(r *http.Request) *store.Principal {
	p, _ := r.Context().Value(ctxPrincipal).(*store.Principal)
	return p
}

func sessionOf(r *http.Request) *store.Session {
	sess, _ := r.Context().Value(ctxSession).(*store.Session)
	return sess
}
