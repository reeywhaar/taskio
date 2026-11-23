package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
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

// accessMarkdown is the page itself.
func accessMarkdown(base string, a *store.Access) string {
	at := func(t time.Time) string { return t.UTC().Format(time.RFC3339) }
	var b strings.Builder
	p := func(format string, args ...any) { fmt.Fprintf(&b, format, args...) }

	p("# taskio: access for an agent\n\n")
	p("This page stops showing the token at %s, five minutes after it was made. Write down the "+
		"token and whatever else you need from here now. The token goes on working until %s.\n\n",
		at(a.LinkExpiresAt), at(a.TokenExpiresAt))
	p("%s has let you into their taskio, a task list with an HTTP API.\n\n", a.Principal.Username)

	p("- Instance: %s\n", base)
	p("- API reference: %s/docs.md, everything the token can do. Read it before the first request.\n", base)
	// What the token reaches as it stands, which may no longer be the project it was made for.
	named := func(r store.AccessReach) string {
		out := fmt.Sprintf("**%s** (`%s`)", r.Project.Name, r.Project.Slug)
		if r.Scope != "" {
			out += fmt.Sprintf(", only the tasks matching `%s`", r.Scope)
		}
		return out
	}
	several := len(a.Reach) != 1
	switch len(a.Reach) {
	case 0:
		p("- Projects: every one the account has. Name one with `?project=` on the routes that " +
			"work inside one; left out, it is the default.\n")
	case 1:
		p("- Project: %s. The token reaches this project and nothing else, so `?project=` can be "+
			"left out.", named(a.Reach[0]))
		if a.Reach[0].Scope != "" {
			p(" Everything you write there has to match too.")
		}
		p("\n")
	default:
		names := make([]string, len(a.Reach))
		for i, r := range a.Reach {
			names[i] = named(r)
		}
		p("- Projects: %s. Name one with `?project=` on every request that works inside a "+
			"project.\n", strings.Join(names, "; "))
	}
	filter := ""
	if a.Group != nil && len(a.Group.Tags) > 0 {
		filter = "and(" + strings.Join(a.Group.Tags, ",") + ")"
		tags := make([]string, len(a.Group.Tags))
		for i, t := range a.Group.Tags {
			tags[i] = "`" + t + "`"
		}
		p("- Scope: work within the group **%s**, the tasks tagged %s. List them with "+
			"`tags=%s`, and give every task you create those tags.\n", a.Group.Name,
			strings.Join(tags, ", "), filter)
	}

	p("\n## The token\n\n")
	p("It works until %s, thirty minutes after this link was made, and then stops. For more time, "+
		"ask whoever sent the link to extend it: the same token goes on working.\n\n",
		at(a.TokenExpiresAt))
	p("```\n%s\n```\n\n", a.Token)
	// Nonced, because an agent's requests end up in its transcript: a raw token there is a live
	// credential in a document nobody treats as a secret, and a nonced one is spent in five
	// minutes. The same recipe as /docs.md, as a function, so each request makes a fresh one.
	p("Keep it out of your transcript from here on: set it once, and send a nonced proof of it "+
		"instead, made fresh for each request and useless five minutes later. The raw token works "+
		"too, but anything it is written into holds a live credential until %s.\n\n",
		at(a.TokenExpiresAt))
	p("```sh\n")
	p("export TASKIO=%s\n", base)
	p("export TOKEN=%s\n\n", a.Token)
	p("nonced() {\n")
	p("  key=$(printf %%s \"$TOKEN\" | shasum -a 256 | cut -d' ' -f1)\n")
	p("  id=${key:0:12}\n")
	p("  ts=$(date +%%s)\n")
	p("  echo \"tkc_$ts.$id.$(printf '%%s.%%s.%%s' \"$ts\" \"$id\" \"$key\" | shasum -a 256 | cut -d' ' -f1)\"\n")
	p("}\n\n")
	var params []string
	if several {
		params = append(params, "project="+a.Project.Slug)
	}
	if filter != "" {
		params = append(params, "tags="+filter)
	}
	query := ""
	if len(params) > 0 {
		query = "?" + strings.Join(params, "&")
	}
	p("curl -sS -H \"Authorization: Bearer $(nonced)\" \"$TASKIO/api/tasks%s\"\n", query)
	p("```\n")
	return b.String()
}
