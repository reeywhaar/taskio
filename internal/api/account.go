package api

import (
	"net/http"

	"taskio/internal/mail"
	"taskio/internal/session"
	"taskio/internal/store"
)

// getAccount is what the settings screen needs about the account itself.
func (s *Server) getAccount(w http.ResponseWriter, r *http.Request) {
	p := principalOf(r)
	email, err := s.store.RecoveryEmail(r.Context(), p.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	relay, err := s.store.Relay(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	used, err := s.store.AssetUsage(r.Context(), p.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	limits, err := s.store.Limits(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"recovery_email":   email,
		"relay_configured": relay.Configured(),
		// The numbers come from the instance's own settings rather than a constant compiled
		// into the bundle: an interface quoting a limit the server does not enforce is worse
		// than one saying nothing.
		"assets": map[string]any{
			"used":  used,
			"quota": limits.AccountQuotaBytes,
			"max":   limits.AssetMaxBytes,
		},
	})
}

type changePasswordRequest struct {
	Current string `json:"current"`
	New     string `json:"new"`
}

// changePassword ends every other session and keeps this one — that is what people mean by it,
// and signing somebody out of the tab they are typing in would be a strange way to confirm it
// worked.
func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	var req changePasswordRequest
	if !decode(w, r, &req) {
		return
	}
	p := principalOf(r)
	if _, err := s.store.Authenticate(r.Context(), p.Username, req.Current); err != nil {
		refuse(w, http.StatusUnauthorized, CodeUnauthenticated, "That is not the current password.")
		return
	}
	keep := store.HashToken(session.Token(r))
	if err := s.store.SetPassword(r.Context(), p.ID, req.New, keep); err != nil {
		s.fail(w, r, err)
		return
	}
	s.log.Info("password changed", "principal", p.ID)
	w.WriteHeader(http.StatusNoContent)
}

type recoveryRequest struct {
	Email string `json:"email"`
}

// startRecovery sends a code to an address, which has to come back before anything is stored.
//
// Until it does the account has no recovery address at all — not a provisional one — so a flow
// abandoned anywhere leaves exactly what was there before. Storing whatever was typed is worse
// than storing nothing: a typo points recovery at a stranger's inbox.
func (s *Server) startRecovery(w http.ResponseWriter, r *http.Request) {
	var req recoveryRequest
	if !decode(w, r, &req) {
		return
	}
	p := principalOf(r)
	relay, err := s.relayFor(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}

	code, err := s.store.StartRecovery(r.Context(), p.ID, req.Email)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	err = mail.Send(*relay, mail.Message{
		To:      req.Email,
		Subject: "Your taskio code",
		Body:    "Your code is " + code + "\n\nIt is good for fifteen minutes.\n",
	})
	if err != nil {
		// A code that could not be sent leaves nothing waiting, or the page says it is waiting
		// on one that never left and the way out is the button somebody just watched fail.
		s.store.DropRecovery(r.Context(), p.ID)
		refuse(w, http.StatusBadGateway, CodeRelayFailed, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type confirmRecoveryRequest struct {
	Code string `json:"code"`
}

func (s *Server) confirmRecovery(w http.ResponseWriter, r *http.Request) {
	var req confirmRecoveryRequest
	if !decode(w, r, &req) {
		return
	}
	if err := s.store.ConfirmRecovery(r.Context(), principalOf(r).ID, req.Code); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) forgetRecovery(w http.ResponseWriter, r *http.Request) {
	if err := s.store.ForgetRecovery(r.Context(), principalOf(r).ID); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
