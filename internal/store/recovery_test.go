package store

import (
	"context"
	"testing"
	"time"
)

// Storing whatever was typed is worse than storing nothing: a typo points recovery at a
// stranger's inbox, and the owner finds out at the one moment they cannot afford to.
func TestNothingIsStoredUntilTheCodeComesBack(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	p, _ := st.CreatePrincipal(ctx, "misha", "a good password", RoleUser)

	if _, err := st.StartRecovery(ctx, p.ID, "misha@example.com"); err != nil {
		t.Fatal(err)
	}
	email, err := st.RecoveryEmail(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if email != "" {
		t.Fatalf("an unproved address is on the account: %q", email)
	}
}

func TestConfirmingMovesTheAddressAcross(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	p, _ := st.CreatePrincipal(ctx, "misha", "a good password", RoleUser)

	code, err := st.StartRecovery(ctx, p.ID, "misha@example.com")
	if err != nil {
		t.Fatal(err)
	}
	// Forgiving about case, spaces, and the letters the alphabet leaves out.
	if err := st.ConfirmRecovery(ctx, p.ID, " "+code[:4]+"-"+code[4:]+" "); err != nil {
		t.Fatal(err)
	}
	email, _ := st.RecoveryEmail(ctx, p.ID)
	if email != "misha@example.com" {
		t.Errorf("email = %q", email)
	}
}

// Five wrong answers throw the attempt away rather than locking anything: a lockout is a state
// somebody has to wait out, and starting again is faster and no weaker.
func TestTooManyWrongCodesThrowTheAttemptAway(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	p, _ := st.CreatePrincipal(ctx, "misha", "a good password", RoleUser)

	code, _ := st.StartRecovery(ctx, p.ID, "misha@example.com")
	for i := 0; i < RecoveryAttempts; i++ {
		if err := st.ConfirmRecovery(ctx, p.ID, "00000000"); err == nil {
			t.Fatal("a wrong code was accepted")
		}
	}
	if err := st.ConfirmRecovery(ctx, p.ID, code); err == nil {
		t.Error("the right code still worked after the attempt was spent")
	}
}

func TestACodeExpires(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	now := time.Date(2026, 9, 16, 4, 0, 0, 0, time.UTC)
	st.SetClock(func() time.Time { return now })

	p, _ := st.CreatePrincipal(ctx, "misha", "a good password", RoleUser)
	code, _ := st.StartRecovery(ctx, p.ID, "misha@example.com")

	now = now.Add(RecoveryLifetime + time.Minute)
	if err := st.ConfirmRecovery(ctx, p.ID, code); err == nil {
		t.Error("an expired code was accepted")
	}
}

// One address, one account, held by whoever proved it last: whoever can read that inbox today
// is who recovery through it would actually reach.
func TestAnAddressMovesToWhoeverProvedItLast(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	first, _ := st.CreatePrincipal(ctx, "misha", "a good password", RoleUser)
	second, _ := st.CreatePrincipal(ctx, "other", "a good password", RoleUser)

	code, _ := st.StartRecovery(ctx, first.ID, "shared@example.com")
	st.ConfirmRecovery(ctx, first.ID, code)

	code, _ = st.StartRecovery(ctx, second.ID, "shared@example.com")
	if err := st.ConfirmRecovery(ctx, second.ID, code); err != nil {
		t.Fatal(err)
	}

	if email, _ := st.RecoveryEmail(ctx, first.ID); email != "" {
		t.Errorf("the first account still has %q", email)
	}
	if email, _ := st.RecoveryEmail(ctx, second.ID); email != "shared@example.com" {
		t.Errorf("the second account has %q", email)
	}
}

// A failed change must leave the address that already worked.
func TestAFailedChangeKeepsTheProvedAddress(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	p, _ := st.CreatePrincipal(ctx, "misha", "a good password", RoleUser)

	code, _ := st.StartRecovery(ctx, p.ID, "first@example.com")
	st.ConfirmRecovery(ctx, p.ID, code)

	// Started and abandoned, the way a send that failed would drop it.
	st.StartRecovery(ctx, p.ID, "second@example.com")
	st.DropRecovery(ctx, p.ID)

	if email, _ := st.RecoveryEmail(ctx, p.ID); email != "first@example.com" {
		t.Errorf("email = %q, want the one that already worked", email)
	}
}
