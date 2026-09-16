package api

import (
	"net/http"
	"regexp"
	"strings"

	"taskio/internal/session"
	"taskio/internal/store"
)

// sessionBody is one sign-in, as the person who made it sees it.
//
// Everything here is descriptive and nothing decides anything, which is what makes it
// acceptable to show a name a browser chose for itself: the question this screen asks is "do I
// recognise this", and a person judges that better than any check would.
type sessionBody struct {
	ID      string `json:"id"`
	Current bool   `json:"current"`
	// CreatedAt and LastSeenAt answer different questions, and together they separate a
	// session quietly alive for a week from one that started an hour ago.
	CreatedAt  int64 `json:"created_at"`
	LastSeenAt int64 `json:"last_seen_at"`
	ExpiresAt  int64 `json:"expires_at"`
	// Device is a guess and UserAgent is what it was guessed from. Both, because the only
	// honest thing to do with a guess is show its working.
	Device    string `json:"device"`
	UserAgent string `json:"user_agent"`
}

func (s *Server) listSessions(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.Sessions(r.Context(), principalOf(r).ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	current := currentSessionID(r)
	out := make([]sessionBody, 0, len(rows))
	for _, sess := range rows {
		out = append(out, sessionBody{
			ID:         sess.ID,
			Current:    sess.ID == current,
			CreatedAt:  sess.CreatedAt.Unix(),
			LastSeenAt: sess.LastSeenAt.Unix(),
			ExpiresAt:  sess.ExpiresAt.Unix(),
			Device:     describeAgent(sess.UserAgent),
			UserAgent:  sess.UserAgent,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": out})
}

// revokeSession ends one of this account's sessions, including the current one.
//
// Revoking the browser you are reading from is a coherent thing to want, and it lands you on
// the login page. Refusing would only move the capability to a button called something else.
func (s *Server) revokeSession(w http.ResponseWriter, r *http.Request) {
	p := principalOf(r)
	id := r.PathValue("id")

	if err := s.store.RevokeSession(r.Context(), p.ID, id); err != nil {
		s.fail(w, r, err)
		return
	}
	if id == currentSessionID(r) {
		// The cookie names a row that is gone. Clearing it here means the page that follows is
		// already signed out rather than signed out one request later.
		s.sessions.Clear(w)
	}
	s.log.Info("session revoked", "principal", p.ID, "session", id)
	w.WriteHeader(http.StatusNoContent)
}

// revokeOtherSessions ends every sign-in but this one.
func (s *Server) revokeOtherSessions(w http.ResponseWriter, r *http.Request) {
	p := principalOf(r)
	n, err := s.store.RevokeOtherSessions(r.Context(), p.ID, session.Token(r))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.log.Info("other sessions revoked", "principal", p.ID, "count", n)
	w.WriteHeader(http.StatusNoContent)
}

// currentSessionID names the session this request arrived on.
//
// Read from the cookie rather than threaded down from the middleware, which carries who you
// are and not which of your sessions said so.
func currentSessionID(r *http.Request) string {
	if token := session.Token(r); token != "" {
		return store.SessionID(token)
	}
	return ""
}

// describeAgent summarises a user agent as a browser and a platform.
//
// A guess, shown beside the string it was guessed from. Order matters: every browser claims to
// be several others, so the most specific claim is tested first.
func describeAgent(ua string) string {
	if ua == "" {
		return ""
	}
	browser := ""
	for _, c := range []struct{ match, name string }{
		{"Edg/", "Edge"},
		{"OPR/", "Opera"},
		{"Firefox/", "Firefox"},
		{"Chrome/", "Chrome"},
		{"Safari/", "Safari"},
		{"curl/", "curl"},
	} {
		if strings.Contains(ua, c.match) {
			browser = c.name
			break
		}
	}
	platform := ""
	for _, c := range []struct{ match, name string }{
		{"iPhone", "iPhone"},
		{"iPad", "iPad"},
		{"Android", "Android"},
		{"Mac OS X", "a Mac"},
		{"Windows", "Windows"},
		{"Linux", "Linux"},
	} {
		if strings.Contains(ua, c.match) {
			platform = c.name
			break
		}
	}
	switch {
	case browser != "" && platform != "":
		return browser + " on " + platform
	case browser != "":
		return browser
	case platform != "":
		return platform
	}
	return firstToken(ua)
}

var tokenRe = regexp.MustCompile(`^[^ /]+`)

func firstToken(ua string) string { return tokenRe.FindString(ua) }
