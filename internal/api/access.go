package api

import (
	_ "embed"
	"errors"
	"net/http"
	"strings"
	"text/template"
	"time"

	"taskio/internal/store"
)

type accessRequest struct {
	// Group is the id of the group the work is meant for, or empty for the whole project.
	Group string `json:"group"`
}

// createAccess makes an agent access link for a project, and a group in it if one is named.
//
// A session's only: it is a person letting an agent in, and an agent does not hand itself
// another.
func (s *Server) createAccess(w http.ResponseWriter, r *http.Request) {
	project, ok := s.projectOf(w, r)
	if !ok {
		return
	}
	var req accessRequest
	if !decode(w, r, &req) {
		return
	}
	code, access, err := s.store.CreateAccess(r.Context(), principalOf(r).ID, project.ID, req.Group)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.log.Info("agent access issued", "principal", principalOf(r).ID, "token", access.TokenID,
		"project", project.ID)
	writeJSON(w, http.StatusCreated, map[string]any{
		"url": s.cfg.Link("/access/" + code),
		// So the dialog can change what it reaches before it is handed over.
		"token":            access.TokenID,
		"expires_at":       access.LinkExpiresAt.Unix(),
		"token_expires_at": access.TokenExpiresAt.Unix(),
	})
}

// accessPage is what an access link opens: markdown, for an agent to read with whatever it
// fetches pages with, and plain enough for curl.
//
// The token is below the opening lines. A chat that previews a pasted link shows its first
// lines, and those say what this is and when it stops, not the secret.
func (s *Server) accessPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex")
	w.Header().Set("Referrer-Policy", "no-referrer")

	access, err := s.store.OpenAccess(r.Context(), r.PathValue("code"))
	if err != nil {
		s.refusedLink(r, err)
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		status := http.StatusInternalServerError
		text := "Something went wrong reading that link.\n"
		if errors.Is(err, store.ErrNotFound) {
			status = http.StatusNotFound
			text = "This access link has expired, or was never one of ours. Ask whoever sent it for a new one.\n"
		} else {
			s.log.Error("access link failed", "err", err)
		}
		w.WriteHeader(status)
		w.Write([]byte(text))
		return
	}
	// Markdown, served as plain text: the link in the dialog is there to be opened and looked at
	// before it is handed over, and plain text is what every browser shows, where not all of
	// them show text/markdown. An agent reads the markdown either way.
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte(accessMarkdown(s.cfg.PublicURL.String(), access)))
}

// accessText is the page, as a template: the words are in access.md.tmpl, where they read as
// the page does, and this works out only what goes into them.
//
//go:embed access.md.tmpl
var accessText string

var accessTemplate = template.Must(template.New("access").Parse(accessText))

// accessPage is what the template is filled with.
type accessPage struct {
	Base, Username, Token, TokenID string
	LinkExpires, TokenExpires      string
	// Reach is what the token reaches as it stands, which may no longer be the project it was
	// made for. None is every project.
	Reach []accessReach
	Group *accessGroup
	// Query is the example request's: the project when the token reaches several, and the
	// group's tags when there is one.
	Query string
}

type accessReach struct{ Name, Slug, Scope string }

type accessGroup struct {
	Name string
	// Tags is them as a sentence names them; Filter as a request does.
	Tags, Filter string
}

// accessMarkdown is the page itself.
func accessMarkdown(base string, a *store.Access) string {
	at := func(t time.Time) string { return t.UTC().Format(time.RFC3339) }
	page := accessPage{
		Base:         base,
		Username:     a.Principal.Username,
		Token:        a.Token,
		TokenID:      a.TokenID,
		LinkExpires:  at(a.LinkExpiresAt),
		TokenExpires: at(a.TokenExpiresAt),
	}
	for _, r := range a.Reach {
		page.Reach = append(page.Reach, accessReach{r.Project.Name, r.Project.Slug, r.Scope})
	}
	var params []string
	if len(a.Reach) != 1 {
		params = append(params, "project="+a.Project.Slug)
	}
	if a.Group != nil && len(a.Group.Tags) > 0 {
		tags := make([]string, len(a.Group.Tags))
		for i, t := range a.Group.Tags {
			tags[i] = "`" + t + "`"
		}
		page.Group = &accessGroup{
			Name:   a.Group.Name,
			Tags:   strings.Join(tags, ", "),
			Filter: "and(" + strings.Join(a.Group.Tags, ",") + ")",
		}
		params = append(params, "tags="+page.Group.Filter)
	}
	if len(params) > 0 {
		page.Query = "?" + strings.Join(params, "&")
	}

	var b strings.Builder
	if err := accessTemplate.Execute(&b, page); err != nil {
		// The template and what it is given are both this file's: an error is a bug here, and
		// a page that says so beats half a page.
		return "This page could not be drawn: " + err.Error() + "\n"
	}
	return b.String()
}
