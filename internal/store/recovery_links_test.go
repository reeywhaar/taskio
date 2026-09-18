package store

import (
	"context"
	"testing"
	"time"
)

func recoverable(t *testing.T, st *Store) *Principal {
	t.Helper()
	p, err := st.CreatePrincipal(context.Background(), "misha", "a good password", RoleUser)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

/**
 * Spending one link closes the others. From the moment a password has moved, a link still
 * sitting in somebody's inbox and one an attacker kept look exactly alike — and the account has
 * just demonstrated it needs neither.
 */
func TestSpendingALinkVoidsTheRest(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	p := recoverable(t, st)

	_, first, err := st.CreateRecoveryLink(ctx, p.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	_, second, err := st.CreateRecoveryLink(ctx, p.ID, "")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := st.UseRecoveryLink(ctx, second, "another good password"); err != nil {
		t.Fatal(err)
	}

	link, err := st.RecoveryLinkByToken(ctx, first)
	if err != nil {
		t.Fatal(err)
	}
	if !link.Voided() {
		t.Error("the outstanding link is still live")
	}
	if _, err := st.UseRecoveryLink(ctx, first, "a third good password"); err == nil {
		t.Error("the voided link still set a password")
	}
}

// Issuing one is an extra door, not a new lock: nothing about the account moves until somebody
// walks through it.
func TestIssuingALinkChangesNothing(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	p := recoverable(t, st)

	if _, _, err := st.CreateRecoveryLink(ctx, p.ID, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Authenticate(ctx, "misha", "a good password"); err != nil {
		t.Error("the old password stopped working when a link was issued")
	}
}

func TestALinkExpires(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	now := time.Date(2026, 9, 18, 4, 0, 0, 0, time.UTC)
	st.SetClock(func() time.Time { return now })
	p := recoverable(t, st)

	_, token, err := st.CreateRecoveryLink(ctx, p.ID, "")
	if err != nil {
		t.Fatal(err)
	}

	now = now.Add(RecoveryLinkLifetime + time.Minute)
	if _, err := st.UseRecoveryLink(ctx, token, "another good password"); err == nil {
		t.Error("an expired link was accepted")
	}
	link, err := st.RecoveryLinkByToken(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	if !link.Expired(now) || link.Usable(now) {
		t.Errorf("an expired link reads as %+v", link)
	}
}

/**
 * A mail that never left is a link whose only copy went nowhere. Left outstanding it would void
 * the account's real link the moment that one was used, and do nothing for anybody.
 */
func TestALinkThatWasNeverSentCanBeTakenBack(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	p := recoverable(t, st)

	link, token, err := st.CreateRecoveryLink(ctx, p.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.VoidRecoveryLink(ctx, link.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.UseRecoveryLink(ctx, token, "another good password"); err == nil {
		t.Error("a link that was never sent still worked")
	}

	// Called to reach a state rather than to perform an operation, so twice is not an error.
	if err := st.VoidRecoveryLink(ctx, link.ID); err != nil {
		t.Errorf("voiding twice = %v", err)
	}
}

// Only a proved address counts. A pending one is a claim, and mailing a way into an account to
// a claim is the hole this whole feature would otherwise be.
func TestOnlyAProvedAddressFindsAnAccount(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	p := recoverable(t, st)

	code, err := st.StartRecovery(ctx, p.ID, "misha@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.PrincipalByRecoveryEmail(ctx, "misha@example.com"); err == nil {
		t.Error("an address nobody has proved found an account")
	}

	if err := st.ConfirmRecovery(ctx, p.ID, code); err != nil {
		t.Fatal(err)
	}
	found, err := st.PrincipalByRecoveryEmail(ctx, "  MISHA@Example.com ")
	if err != nil {
		t.Fatal(err)
	}
	if found.ID != p.ID {
		t.Errorf("found %s, want %s", found.ID, p.ID)
	}
}

// What goes is what lapsed outstanding. A spent link stays: it is the record of how somebody
// got back in, which is the first thing anybody looking into a stolen account wants.
func TestTheSweepKeepsSpentLinksAndCollectsLapsedOnes(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	now := time.Date(2026, 9, 18, 4, 0, 0, 0, time.UTC)
	st.SetClock(func() time.Time { return now })
	p := recoverable(t, st)

	_, spent, _ := st.CreateRecoveryLink(ctx, p.ID, "")
	if _, err := st.UseRecoveryLink(ctx, spent, "another good password"); err != nil {
		t.Fatal(err)
	}
	_, lapsed, _ := st.CreateRecoveryLink(ctx, p.ID, "")

	now = now.Add(RecoveryLinkLifetime + time.Hour)
	n, err := st.SweepRecoveryLinks(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("swept %d, want the one that lapsed", n)
	}
	if _, err := st.RecoveryLinkByToken(ctx, spent); err != nil {
		t.Errorf("the spent link is gone: %v", err)
	}
	if _, err := st.RecoveryLinkByToken(ctx, lapsed); err == nil {
		t.Error("the lapsed link is still there")
	}
}
