// Package api is taskio's HTTP surface: handlers, the guard, and static serving.
//
// It takes an fs.FS, so tests drive an fstest.MapFS and `go test ./...` passes with no
// frontend build present.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"taskio/internal/app"
	"taskio/internal/config"
	"taskio/internal/filter"
	"taskio/internal/session"
	"taskio/internal/store"
)

// bodyMax bounds a JSON request. Asset uploads have their own, larger, limit.
const bodyMax = 1 << 20

// assetUploadPath is the one route that carries a body which is not JSON.
const assetUploadPath = "/api/assets"

// Server holds what every handler needs.
//
// Rate limiters belong on it, not at package level: two instances in one process would
// otherwise share one budget.
type Server struct {
	cfg      *config.Config
	log      *slog.Logger
	store    *store.Store
	sessions *session.Manager
	spa      *SPA
	docs     *Docs
	mux      *http.ServeMux

	loginAll  *limiter
	loginUser *limiter
	tokenAuth *limiter

	routes      []string
	agentRoutes []string
}

// handle registers a pattern a browser reaches.
func (s *Server) handle(pattern string, h http.Handler) {
	s.routes = append(s.routes, pattern)
	s.mux.Handle(pattern, h)
}

// handleAgent registers a pattern a token reaches, which is the set docs/api.md has to cover.
//
// Recorded here rather than matched by prefix in a test, so the two cannot drift: a route
// becomes an agent's the moment it is registered with this, and the test notices.
func (s *Server) handleAgent(pattern string, h http.Handler) {
	s.agentRoutes = append(s.agentRoutes, pattern)
	s.handle(pattern, h)
}

// New wires the routes. Authorisation is decided at registration, so a handler cannot forget
// to check: one registered without its guard is visibly registered without it.
func New(cfg *config.Config, log *slog.Logger, st *store.Store, spa *SPA, docs *Docs) *Server {
	s := &Server{
		cfg:      cfg,
		log:      log,
		store:    st,
		sessions: session.New(st, cfg.Secure),
		spa:      spa,
		docs:     docs,
		mux:      http.NewServeMux(),

		loginAll:  newLimiter(30, 2*time.Second),
		loginUser: newLimiter(5, 20*time.Second),
		tokenAuth: newLimiter(60, time.Second),
	}

	s.mux.HandleFunc("GET /healthz", s.healthz)

	// Unauthenticated, because an agent has to read it before there is any question of a
	// credential.
	s.mux.Handle("GET /docs", docs)
	s.mux.Handle("GET /docs.md", docs)
	s.mux.HandleFunc("GET /llms.txt", s.llms)

	// Everything about proving who you are is under one root. An invitation belongs here
	// rather than under a resource of its own: accepting one is how an account starts.
	s.mux.HandleFunc("POST /api/auth/login", s.login)
	s.mux.HandleFunc("GET /api/auth/invites/{token}", s.getInvite)
	s.mux.HandleFunc("POST /api/auth/invites/{token}/accept", s.acceptInvite)
	s.handle("POST /api/auth/logout", s.requireSession(s.logout))
	s.handle("GET /api/auth/me", s.requireSession(s.me))

	// A browser's own channel: an agent asking what changed has the list endpoints and a
	// schedule of its own, and no reason to hold a connection open between them.
	s.handle("GET /api/events", s.requireSession(s.events))

	s.handleAgent("GET /api/tasks", s.requireAuth(s.listTasks))
	s.handleAgent("POST /api/tasks", s.requireAuth(s.createTask))
	s.handleAgent("GET /api/tasks/{id}", s.requireAuth(s.getTask))
	s.handleAgent("PATCH /api/tasks/{id}", s.requireAuth(s.patchTask))
	s.handleAgent("POST /api/tasks/{id}/done", s.requireAuth(s.setDone(true)))
	s.handleAgent("POST /api/tasks/{id}/todo", s.requireAuth(s.setDone(false)))
	s.handleAgent("DELETE /api/tasks/{id}", s.requireAuth(s.deleteTask))

	s.handleAgent("POST /api/tasks/bulk/done", s.requireAuth(s.bulkDone(true)))
	s.handleAgent("POST /api/tasks/bulk/todo", s.requireAuth(s.bulkDone(false)))
	s.handleAgent("POST /api/tasks/bulk/tags", s.requireAuth(s.bulkTags))
	s.handleAgent("POST /api/tasks/bulk/delete", s.requireAuth(s.bulkDelete))

	s.handleAgent("POST /api/assets", s.requireAuth(s.putAsset))
	s.handleAgent("GET /api/assets/{id}", s.requireAuth(s.getAsset))

	s.handleAgent("GET /api/tags", s.requireAuth(s.listTags))
	s.handleAgent("PATCH /api/tags/{slug}", s.requireAuth(s.renameTag))
	s.handleAgent("DELETE /api/tags/{slug}", s.requireAuth(s.removeTag))

	// Tokens are session-only: a credential must not mint or manage credentials, and a stolen
	// one that could read this could see where somebody signs in from.
	s.handle("GET /api/tokens", s.requireSession(s.listTokens))
	s.handle("POST /api/tokens", s.requireSession(s.createToken))
	s.handle("PATCH /api/tokens/{id}", s.requireSession(s.patchToken))
	s.handle("DELETE /api/tokens/{id}", s.requireSession(s.revokeToken))

	s.handle("GET /api/account", s.requireSession(s.getAccount))
	s.handle("POST /api/account/password", s.requireSession(s.changePassword))
	s.handle("POST /api/account/recovery", s.requireSession(s.startRecovery))
	s.handle("POST /api/account/recovery/confirm", s.requireSession(s.confirmRecovery))
	s.handle("DELETE /api/account/recovery", s.requireSession(s.forgetRecovery))

	s.handle("GET /api/admin/users", s.requireAdmin(s.listUsers))
	s.handle("POST /api/admin/invites", s.requireAdmin(s.createInvite))
	s.handle("GET /api/admin/relay", s.requireAdmin(s.getRelay))
	s.handle("PUT /api/admin/relay", s.requireAdmin(s.putRelay))
	s.handle("DELETE /api/admin/relay", s.requireAdmin(s.deleteRelay))
	s.handle("POST /api/admin/relay/test", s.requireAdmin(s.testRelay))
	s.handle("GET /api/admin/limits", s.requireAdmin(s.getLimits))
	s.handle("PUT /api/admin/limits", s.requireAdmin(s.putLimits))

	s.handle("GET /api/sessions", s.requireSession(s.listSessions))
	s.handle("DELETE /api/sessions/{id}", s.requireSession(s.revokeSession))
	s.handle("DELETE /api/sessions", s.requireSession(s.revokeOtherSessions))

	// Catch-all, so a mistyped API path never falls through to the SPA and reaches a fetch as
	// an HTML document it cannot parse.
	s.mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		refuse(w, http.StatusNotFound, CodeNotFound, "There is no such endpoint. /docs lists them all.")
	})

	s.mux.Handle("/", s.gate(spa))
	return s
}

// gate decides who gets which document, before the bundle loads.
//
// A signed-out visitor handed the application shell sees the whole interface draw and then
// every panel in it fail, which reads as a broken taskio rather than as a sign-in page. The
// answer has to be here: the island cannot ask before it has loaded, and by then it has drawn.
//
// Only shells are gated. A file is served to anybody, which is what lets the sign-in page load
// its own stylesheet.
func (s *Server) gate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sh := s.spa.shellFor(r.URL.Path)
		if sh == nil {
			next.ServeHTTP(w, r)
			return
		}
		_, err := s.sessions.Resolve(r.Context(), w, r)
		switch {
		case err != nil && !sh.public:
			redirect(w, r, "/login")
		case err == nil && r.URL.Path == signInPath:
			// Somebody already signed in asking for the sign-in page means a stale tab or a
			// bookmark, not a second account.
			redirect(w, r, "/")
		default:
			next.ServeHTTP(w, r)
		}
	})
}

// signInPath is the one shell a signed-in visitor is sent away from. /invite is not: see the
// shell table.
const signInPath = "/login"

// redirect sends a navigation elsewhere, uncached.
//
// Without no-store a browser is entitled to remember that / redirects, and would keep doing it
// after the sign-in that fixed it.
func redirect(w http.ResponseWriter, r *http.Request, to string) {
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, to, http.StatusFound)
}

// Routes is every pattern registered.
func (s *Server) Routes() []string { return append([]string(nil), s.routes...) }

// AgentRoutes is what a token can reach, and therefore what docs/api.md has to document.
//
// An endpoint added, renamed or removed is the thing that actually rots a reference; the prose
// around it is a human's job, which a generator would do badly.
func (s *Server) AgentRoutes() []string { return append([]string(nil), s.agentRoutes...) }

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.guard(s.mux).ServeHTTP(w, r)
}

func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": app.Version})
}

// guard is the CSRF defence: SameSite on the cookie, Sec-Fetch-Site, and a declared content
// type. It leans on this origin being the only one the browser talks to, which a test pins by
// asserting no Access-Control-Allow-Origin is ever emitted.
//
// Once tokens exist, a request carrying Authorization is a token request and the cookie is
// ignored — one identity per request, decided before any handler runs.
func (s *Server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}
		// A browser sets this; a script cannot forge it.
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			refuse(w, http.StatusForbidden, CodeForbidden, "That request came from somewhere else.")
			return
		}
		// Only when a body is present: a DELETE legitimately carries none. An upload is the
		// one route whose body is not JSON by definition, and the Sec-Fetch-Site check above
		// still covers it.
		if r.ContentLength != 0 && r.URL.Path != assetUploadPath && !isJSON(r.Header.Get("Content-Type")) {
			refuse(w, http.StatusUnsupportedMediaType, CodeUnsupportedMediaType, "Send application/json.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// decode reads a JSON body into v, refusing anything it does not recognise.
//
// Never into a map: a map accepts anything and moves every validation into the handler, one
// forgotten check at a time. DisallowUnknownFields also means a caller's typo'd field is a
// refusal saying so rather than a silently ignored intention.
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(io.LimitReader(r.Body, bodyMax))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		refuse(w, http.StatusBadRequest, CodeInvalid, "That request body is not the JSON this expects: "+err.Error())
		return false
	}
	return true
}

// fail maps a store error onto a status and a code, in the one place that does.
//
// The message is the store's own, because it was written for whoever reads it.
func (s *Server) fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errOutOfScope):
		// Authenticated, and the thing is theirs; what is refused is this credential's reach.
		// A 404 would have an agent conclude the task is gone and act on it.
		refuse(w, http.StatusForbidden, CodeOutOfScope,
			"This token is scoped to "+scopeSentence(r)+", and that task is outside it.")
	case errors.Is(err, store.ErrNotFound):
		refuse(w, http.StatusNotFound, CodeNotFound, sentence(err, "There is no such thing."))
	case errors.Is(err, store.ErrConflict):
		refuse(w, http.StatusConflict, CodeConflict, sentence(err, "That already exists."))
	case errors.Is(err, store.ErrTooLarge):
		// Three things answer 413 and the code says which, so a caller knows whether to send a
		// smaller image, fewer images, or to delete something.
		refuse(w, http.StatusRequestEntityTooLarge, codeForTooLarge(err), sentence(err, "That is too large."))
	case errors.Is(err, store.ErrInvalid):
		refuse(w, http.StatusBadRequest, CodeInvalid, sentence(err, "That request is not valid."))
	default:
		// An unclassified error is a bug, and the message that reaches the caller deliberately
		// does not say what it was.
		s.log.Error("request failed", "path", r.URL.Path, "err", err)
		refuse(w, http.StatusInternalServerError, CodeInternal, "Something went wrong here.")
	}
}

// codeForTooLarge tells the three 413s apart by what the sentence says.
func codeForTooLarge(err error) string {
	switch msg := err.Error(); {
	case strings.Contains(msg, "storage"):
		return CodeQuotaExceeded
	case strings.Contains(msg, "more than"):
		return CodeAssetCountExceeded
	default:
		return CodeAssetTooLarge
	}
}

// scopeSentence names the scope in a refusal, so a caller knows why rather than only that.
func scopeSentence(r *http.Request) string {
	if scope := scopeOf(r); scope != nil {
		return filter.Print(scope)
	}
	return "a narrower view"
}

// sentence is the error's own text when it carries one written for a reader.
func sentence(err error, fallback string) string {
	msg := err.Error()
	if msg == "" || msg == "not found" || msg == "already exists" || msg == "invalid" {
		return fallback
	}
	return msg
}

func isJSON(ct string) bool {
	for i := 0; i < len(ct); i++ {
		if ct[i] == ';' {
			ct = ct[:i]
			break
		}
	}
	for len(ct) > 0 && ct[len(ct)-1] == ' ' {
		ct = ct[:len(ct)-1]
	}
	return ct == "application/json"
}

func contextWith(ctx context.Context, k ctxKey, v any) context.Context {
	return context.WithValue(ctx, k, v)
}
