package api

import (
	"context"
	"net/http"
	"strings"

	"taskio/internal/mail"
)

// This file is getting back into an account whose password is gone. There are two ways in, and
// they mint the same kind of link:
//
//   - an administrator hands one over, out of band, to somebody who has asked for it — from the
//     admin page or from the command line on the host;
//   - the account asks for one itself at the login form, and it is mailed to the address that
//     account has proved it can read.
//
// The second exists only where a relay is configured, which is why the login form has to be
// able to ask — see [Server.instance]. The first works on any instance, including one that can
// send no mail at all, and is the reason this is not simply "forgot password": a self-hosted
// instance with no relay still needs a way back in that is not a shell on the host. Though
// there is one of those too, for the instance whose only administrator is the one locked out.

// recoveryLinkBody is a minted link. The URL is in it exactly once, in the reply that made it.
type recoveryLinkBody struct {
	URL       string `json:"url"`
	ExpiresAt int64  `json:"expires_at"`
	Username  string `json:"username"`
}

// createUserRecovery mints a link for an administrator to pass on.
//
// It changes nothing about the account. Nobody is signed out, no password moves, and the account
// holder is not told — so an administrator can answer "I am locked out" without also locking out
// somebody who turns out to have been fine. A link nobody uses simply lapses.
//
// Deliberately not sent from here even where a relay exists. This is the path for somebody
// standing in front of you, or on a call, or on an instance whose mail has never worked; the one
// that goes to an inbox is [Server.requestRecovery], and it is the account's own to ask for. An
// administrator who could both mail a link and read it would hold a way into every account.
func (s *Server) createUserRecovery(w http.ResponseWriter, r *http.Request) {
	caller := principalOf(r)
	id := r.PathValue("id")

	link, token, err := s.store.CreateRecoveryLink(r.Context(), id, caller.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	p, err := s.store.PrincipalByID(r.Context(), id)
	if err != nil {
		s.fail(w, r, err)
		return
	}

	// Who it was for and who asked, never the link. A log is read by more people than the one
	// who should be holding it.
	s.log.Info("recovery link issued", "by", caller.ID, "principal", id, "link", link.ID)

	writeJSON(w, http.StatusCreated, recoveryLinkBody{
		URL:       s.cfg.Link("/recover/" + token),
		ExpiresAt: link.ExpiresAt.Unix(),
		Username:  p.Username,
	})
}

// requestRecovery mails a link to whoever proved they can read that address.
//
// It answers 204 whatever happens: address unknown, account disabled, no relay, relay refused
// the message. Anything else turns the form into a way to ask this instance who has an account
// here and what address they use, which is exactly the list an unauthenticated caller must not
// be able to build. Whoever owns the address gets the same page either way and then looks in
// their inbox, which is the only place the answer belongs.
//
// The cost is that somebody who mistypes their address is told nothing. That is the trade every
// implementation of this makes, and the mail itself carries the correction: it names the
// account, so a link arriving for a name you do not recognise is its own answer.
func (s *Server) requestRecovery(w http.ResponseWriter, r *http.Request) {
	var req recoveryRequest
	if !decode(w, r, &req) {
		return
	}
	address := strings.TrimSpace(req.Email)
	if address == "" {
		refuse(w, http.StatusBadRequest, CodeInvalid, "An address is required.")
		return
	}

	// Two buckets, as the login form has. The global one is the relay's protection — this
	// endpoint posts mail to an address a stranger chose, and nothing else on the instance
	// does. The per-address one stops one mailbox being buried by somebody who has worked out
	// whose it is.
	if !s.mailAll.allow("") || !s.mailUser.allow(strings.ToLower(address)) {
		refuse(w, http.StatusTooManyRequests, CodeRateLimited, "That is a lot of requests. Wait a minute.")
		return
	}

	if err := s.mailRecoveryLink(r, address); err != nil {
		// Logged, not reported. Every one of these is a reason the caller must not be told
		// apart from success.
		s.log.Info("recovery link not sent", "reason", err)
	}
	w.WriteHeader(http.StatusNoContent)
}

// mailRecoveryLink is everything requestRecovery does that is allowed to fail.
//
// Split out so the handler above has exactly one exit for the whole flow. Written the other way
// — a refusal at each step — it is one forgotten return away from answering differently for an
// address that exists, and that difference is the entire vulnerability.
func (s *Server) mailRecoveryLink(r *http.Request, address string) error {
	relay, err := s.relayFor(r)
	if err != nil {
		return err
	}

	p, err := s.store.PrincipalByRecoveryEmail(r.Context(), address)
	if err != nil {
		return err
	}

	link, token, err := s.store.CreateRecoveryLink(r.Context(), p.ID, "")
	if err != nil {
		return err
	}
	url := s.cfg.Link("/recover/" + token)

	if err := mail.Send(*relay, mail.Message{
		To:      address,
		Subject: "Getting back into your taskio account",
		Body: "Somebody asked for a way back into the taskio account " + p.Username + ".\n\n" +
			url + "\n\n" +
			"Open it to set a new password. The link is good until " +
			link.ExpiresAt.Format("2 January 2006 at 15:04 MST") + ", and works once.\n\n" +
			"Until you use it nothing has changed: your old password still works and you are " +
			"still signed in wherever you were. If you did not ask for this, ignore it.\n",
	}); err != nil {
		// Nothing was sent, so nothing should be outstanding — the link's only copy went
		// nowhere, and the way out of that state is asking for another one anyway.
		//
		// WithoutCancel because this must happen even when the request is being abandoned: the
		// row is the thing that would otherwise outlive the failure.
		if err := s.store.VoidRecoveryLink(context.WithoutCancel(r.Context()), link.ID); err != nil {
			s.log.Error("could not void a recovery link that was never sent", "link", link.ID, "err", err)
		}
		return err
	}

	s.log.Info("recovery link sent", "principal", p.ID, "link", link.ID)
	return nil
}

// recoveryBody is what a link is, before anybody types a password into it.
type recoveryBody struct {
	// Username is whose account this opens.
	//
	// Shown to whoever holds the token — who could take the account with it — so it gives up
	// nothing, and it is the one thing that makes the page checkable: a name you do not
	// recognise means the link is not for you.
	Username  string `json:"username"`
	ExpiresAt int64  `json:"expires_at"`
	Usable    bool   `json:"usable"`
	Used      bool   `json:"used"`
	Voided    bool   `json:"voided"`
	Expired   bool   `json:"expired"`
}

// getRecovery reports what state a link is in, before somebody types a password into it.
//
// Four states a person acts on differently — set a password, sign in with the one you already
// set, use the newer link, or ask for another — and collapsing them into one refusal leaves all
// four doing the same useless thing.
func (s *Server) getRecovery(w http.ResponseWriter, r *http.Request) {
	link, err := s.store.RecoveryLinkByToken(r.Context(), r.PathValue("token"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	p, err := s.store.PrincipalByID(r.Context(), link.PrincipalID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	now := s.store.Now()
	writeJSON(w, http.StatusOK, recoveryBody{
		Username:  p.Username,
		ExpiresAt: link.ExpiresAt.Unix(),
		Usable:    link.Usable(now),
		Used:      link.Used(),
		Voided:    link.Voided(),
		Expired:   link.Expired(now),
	})
}

type acceptRecoveryRequest struct {
	Password string `json:"password"`
}

// acceptRecovery spends a link on a new password.
//
// It does not sign anybody in, and that is the difference from accepting an invitation. There,
// somebody has just chosen the password for an account that did not exist a moment ago, and
// asking for it again proves nothing. Here the account existed, the link may have reached the
// wrong person, and typing the new password at the login form once is the cheapest confirmation
// there is that the right one has it.
func (s *Server) acceptRecovery(w http.ResponseWriter, r *http.Request) {
	var req acceptRecoveryRequest
	if !decode(w, r, &req) {
		return
	}
	// Shares the login bucket: this endpoint is unauthenticated and runs bcrypt, which is the
	// property that matters, not what it is called.
	if !s.loginAll.allow("") {
		refuse(w, http.StatusTooManyRequests, CodeRateLimited, "Too many attempts. Wait a minute.")
		return
	}

	p, err := s.store.UseRecoveryLink(r.Context(), r.PathValue("token"), req.Password)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.log.Info("account recovered", "principal", p.ID)
	w.WriteHeader(http.StatusNoContent)
}

// instanceBody is what a stranger at the front door is allowed to know about this instance. One
// field so far, and it is here because the login form needs it.
type instanceBody struct {
	// Recovery is whether somebody who has forgotten their password can be mailed a link.
	//
	// Which is to say: whether a relay is configured. Offered rather than hidden, because the
	// alternative is a form that takes an address, says "check your inbox" and is lying — and
	// because an instance that cannot send mail is something anybody finds out by being invited
	// to it. Where this is false the login form offers nothing, and somebody locked out asks
	// whoever runs the instance, which is the only path there was.
	Recovery bool `json:"recovery"`
}

func (s *Server) instance(w http.ResponseWriter, r *http.Request) {
	relay, err := s.store.Relay(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, instanceBody{Recovery: relay.Configured()})
}
