package api

import (
	"net/http"
	"strings"

	"taskio/internal/mail"
	"taskio/internal/store"
)

// relayBody is the relay as the form sees it.
//
// The password never comes back out: readable by anything that can read a response, for no
// gain, since the form does not need it to save a change.
type relayBody struct {
	Configured  bool   `json:"configured"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Security    string `json:"security"`
	Username    string `json:"username"`
	PasswordSet bool   `json:"password_set"`
	FromAddress string `json:"from_address"`
	FromName    string `json:"from_name"`
}

func (s *Server) getRelay(w http.ResponseWriter, r *http.Request) {
	relay, err := s.store.Relay(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if relay == nil {
		writeJSON(w, http.StatusOK, relayBody{Port: 587, Security: store.SecurityStartTLS})
		return
	}
	writeJSON(w, http.StatusOK, relayBody{
		Configured:  true,
		Host:        relay.Host,
		Port:        relay.Port,
		Security:    relay.Security,
		Username:    relay.Username,
		PasswordSet: relay.Password != "",
		FromAddress: relay.FromAddress,
		FromName:    relay.FromName,
	})
}

type putRelayRequest struct {
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Security    string `json:"security"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	FromAddress string `json:"from_address"`
	FromName    string `json:"from_name"`
}

func (s *Server) putRelay(w http.ResponseWriter, r *http.Request) {
	var req putRelayRequest
	if !decode(w, r, &req) {
		return
	}
	err := s.store.SetRelay(r.Context(), store.Relay{
		Host:        req.Host,
		Port:        req.Port,
		Security:    req.Security,
		Username:    req.Username,
		Password:    req.Password,
		FromAddress: req.FromAddress,
		FromName:    req.FromName,
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.getRelay(w, r)
}

func (s *Server) deleteRelay(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteRelay(r.Context()); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type testRelayRequest struct {
	To string `json:"to"`
}

// testRelay sends one message and answers with what happened.
//
// A refusal is a 502 carrying the relay's own words. Not a 500: everything on this side worked
// and something upstream did not, and a 500 sends an operator through the wrong logs. Not
// "sending failed" either — "the host was wrong", "the credentials were rejected" and "the
// certificate did not verify" are three different afternoons.
func (s *Server) testRelay(w http.ResponseWriter, r *http.Request) {
	var req testRelayRequest
	if !decode(w, r, &req) {
		return
	}
	relay, err := s.relayFor(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	err = mail.Send(*relay, mail.Message{
		To:      strings.TrimSpace(req.To),
		Subject: "taskio test",
		Body:    "This is taskio, checking that it can hand a message to your relay.\n",
	})
	if err != nil {
		refuse(w, http.StatusBadGateway, CodeRelayFailed, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// relayFor reads the configured relay in the shape the sender wants.
func (s *Server) relayFor(r *http.Request) (*mail.Relay, error) {
	relay, err := s.store.Relay(r.Context())
	if err != nil {
		return nil, err
	}
	if relay == nil {
		return nil, store.Invalid("There is no mail relay configured.")
	}
	return &mail.Relay{
		Host:        relay.Host,
		Port:        relay.Port,
		Implicit:    relay.Security == store.SecurityImplicit,
		Username:    relay.Username,
		Password:    relay.Password,
		FromAddress: relay.FromAddress,
		FromName:    relay.FromName,
	}, nil
}

func (s *Server) getLimits(w http.ResponseWriter, r *http.Request) {
	limits, err := s.store.Limits(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"asset_max_bytes":     limits.AssetMaxBytes,
		"account_quota_bytes": limits.AccountQuotaBytes,
	})
}

type putLimitsRequest struct {
	AssetMaxBytes     int64 `json:"asset_max_bytes"`
	AccountQuotaBytes int64 `json:"account_quota_bytes"`
}

func (s *Server) putLimits(w http.ResponseWriter, r *http.Request) {
	var req putLimitsRequest
	if !decode(w, r, &req) {
		return
	}
	err := s.store.SetLimits(r.Context(), store.Limits{
		AssetMaxBytes:     req.AssetMaxBytes,
		AccountQuotaBytes: req.AccountQuotaBytes,
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.getLimits(w, r)
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.Principals(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	out := make([]map[string]any, 0, len(users))
	for _, p := range users {
		out = append(out, map[string]any{
			"id": p.ID, "username": p.Username, "role": p.Role,
			"created_at": p.CreatedAt.Unix(),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

type createInviteRequest struct {
	Role string `json:"role"`
}

// createInvite mints a link and returns it once.
func (s *Server) createInvite(w http.ResponseWriter, r *http.Request) {
	var req createInviteRequest
	if !decode(w, r, &req) {
		return
	}
	if req.Role == "" {
		req.Role = store.RoleUser
	}
	inv, token, err := s.store.CreateInvite(r.Context(), principalOf(r).ID, req.Role)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"link":       s.cfg.Link("/invite/" + token),
		"role":       inv.Role,
		"expires_at": inv.ExpiresAt.Unix(),
	})
}
