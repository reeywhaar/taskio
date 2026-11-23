package store

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"
)

func accessFixture(t *testing.T) (*Store, *Principal, string, func(time.Duration)) {
	t.Helper()
	st := openStore(t)
	p, err := st.CreatePrincipal(context.Background(), "misha", "a good password", RoleUser)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 11, 22, 12, 0, 0, 0, time.UTC)
	now := start
	st.SetClock(func() time.Time { return now })
	return st, p, home(t, st, p.ID), func(d time.Duration) { now = start.Add(d) }
}

// The link shows its token for five minutes; the token works for thirty from when it was made.
func TestAnAccessLinkShowsItsTokenForFiveMinutes(t *testing.T) {
	st, p, project, at := accessFixture(t)
	ctx := context.Background()
	g, err := st.CreateGroup(ctx, p.ID, project, "Garden", []string{"garden"}, "")
	if err != nil {
		t.Fatal(err)
	}

	code, made, err := st.CreateAccess(ctx, p.ID, project, g.ID)
	if err != nil {
		t.Fatal(err)
	}
	if made.Group == nil || made.Group.Name != "Garden" || made.Project.ID != project {
		t.Fatalf("made = %+v", made)
	}

	at(4 * time.Minute)
	got, err := st.OpenAccess(ctx, code)
	if err != nil {
		t.Fatal(err)
	}
	if got.Token != made.Token || got.Group == nil || got.Group.ID != g.ID {
		t.Fatalf("opened = %+v", got)
	}
	tok, err := st.AuthenticateToken(ctx, got.Token)
	if err != nil {
		t.Fatal(err)
	}
	reach, _ := tok.Reach()
	if _, ok := reach[project]; !ok || len(reach) != 1 || reach[project] != nil {
		t.Errorf("reach = %v, want the whole of one project", reach)
	}

	at(5 * time.Minute)
	if _, err := st.OpenAccess(ctx, code); !errors.Is(err, ErrNotFound) {
		t.Errorf("open after five minutes = %v, want not found", err)
	}
	at(29 * time.Minute)
	if _, err := st.AuthenticateToken(ctx, made.Token); err != nil {
		t.Errorf("token at 29 minutes = %v", err)
	}
	at(30 * time.Minute)
	if _, err := st.AuthenticateToken(ctx, made.Token); err == nil {
		t.Error("token works past thirty minutes")
	}
}

// Letting an agent in is not content: no backup goes out for it, nor for sweeping it away.
func TestAccessIsNotAChangeABackupIsSentFor(t *testing.T) {
	st, p, project, at := accessFixture(t)
	ctx := context.Background()
	before := st.Changes()

	code, made, err := st.CreateAccess(ctx, p.ID, project, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.OpenAccess(ctx, code); err != nil {
		t.Fatal(err)
	}
	if _, err := st.AuthenticateToken(ctx, made.Token); err != nil {
		t.Fatal(err)
	}
	// The link goes once it stops showing the token; the token an hour after it stops working,
	// kept that long to be extended.
	at(31 * time.Minute)
	if n, err := st.SweepAccess(ctx); err != nil || n != 1 {
		t.Errorf("swept at 31 minutes = %d, %v; want the link alone", n, err)
	}
	at(91 * time.Minute)
	if n, err := st.SweepAccess(ctx); err != nil || n != 1 {
		t.Errorf("swept at 91 minutes = %d, %v; want the token", n, err)
	}
	if after := st.Changes(); after != before {
		t.Errorf("changes went from %d to %d", before, after)
	}
	var left int
	st.reader.QueryRow(`SELECT COUNT(*) FROM tokens`).Scan(&left)
	if left != 0 {
		t.Errorf("tokens after the sweep = %d, want none", left)
	}
}

// Listed while it works, to be revoked, and for an hour after, to be extended; never revoked, nor
// longer lapsed, where there would be one for every time somebody let an agent in.
func TestAnAccessTokenIsListedWhileItCanStillBeUsed(t *testing.T) {
	st, p, project, at := accessFixture(t)
	ctx := context.Background()
	_, first, err := st.CreateAccess(ctx, p.ID, project, "")
	if err != nil {
		t.Fatal(err)
	}
	_, second, err := st.CreateAccess(ctx, p.ID, project, "")
	if err != nil {
		t.Fatal(err)
	}
	listed := func() []string {
		list, err := st.Tokens(ctx, p.ID)
		if err != nil {
			t.Fatal(err)
		}
		var ids []string
		for _, tok := range list {
			ids = append(ids, tok.ID)
		}
		return ids
	}
	if got := listed(); len(got) != 2 {
		t.Fatalf("listed = %v, want both", got)
	}
	if err := st.RevokeToken(ctx, p.ID, first.TokenID); err != nil {
		t.Fatal(err)
	}
	if got := listed(); len(got) != 1 || got[0] != second.TokenID {
		t.Errorf("listed after revoking one = %v, want only %s", got, second.TokenID)
	}
	// Lapsed, but within the hour it can be extended in.
	at(30 * time.Minute)
	if got := listed(); len(got) != 1 {
		t.Errorf("listed after thirty minutes = %v, want the lapsed one", got)
	}
	// An hour past, and not yet swept: not listed.
	at(90 * time.Minute)
	if got := listed(); len(got) != 0 {
		t.Errorf("listed after ninety minutes = %v, want none", got)
	}
}

// Another half hour: from when it would have stopped, or from now once it has, within the hour
// it is kept; and no backup for it.
func TestExtendingAccess(t *testing.T) {
	st, p, project, at := accessFixture(t)
	ctx := context.Background()
	_, made, err := st.CreateAccess(ctx, p.ID, project, "")
	if err != nil {
		t.Fatal(err)
	}
	before := st.Changes()
	start := time.Date(2026, 11, 22, 12, 0, 0, 0, time.UTC)

	at(10 * time.Minute)
	tok, err := st.ExtendAccess(ctx, p.ID, made.TokenID)
	if err != nil {
		t.Fatal(err)
	}
	if want := start.Add(60 * time.Minute); !tok.ExpiresAt.Equal(want) {
		t.Errorf("extended while working = %v, want %v", tok.ExpiresAt, want)
	}

	// Lapsed twenty minutes ago: half an hour from now, and it works again.
	at(80 * time.Minute)
	if _, err := st.AuthenticateToken(ctx, made.Token); err == nil {
		t.Fatal("a lapsed token works")
	}
	tok, err = st.ExtendAccess(ctx, p.ID, made.TokenID)
	if err != nil {
		t.Fatal(err)
	}
	if want := start.Add(110 * time.Minute); !tok.ExpiresAt.Equal(want) {
		t.Errorf("extended after lapsing = %v, want %v", tok.ExpiresAt, want)
	}
	if _, err := st.AuthenticateToken(ctx, made.Token); err != nil {
		t.Errorf("the extended token = %v", err)
	}

	// More than an hour past: gone, whether or not the sweep has been.
	at(171 * time.Minute)
	if _, err := st.ExtendAccess(ctx, p.ID, made.TokenID); !errors.Is(err, ErrNotFound) {
		t.Errorf("extending an hour past = %v, want not found", err)
	}
	if after := st.Changes(); after != before {
		t.Errorf("changes went from %d to %d", before, after)
	}

	// Only an agent's: a token made on purpose has its own clocks.
	plain, _, err := st.CreateToken(ctx, p.ID, "claude", nil, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.ExtendAccess(ctx, p.ID, plain.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("extending a plain token = %v, want not found", err)
	}
}

// A copy of the table opens nothing: the code is only a hash, and the token is sealed with it.
func TestTheTableHoldsNeitherTheCodeNorTheToken(t *testing.T) {
	st, p, project, _ := accessFixture(t)
	ctx := context.Background()
	code, made, err := st.CreateAccess(ctx, p.ID, project, "")
	if err != nil {
		t.Fatal(err)
	}
	var id string
	var sealed []byte
	if err := st.reader.QueryRow(`SELECT id, sealed FROM access_links`).Scan(&id, &sealed); err != nil {
		t.Fatal(err)
	}
	if id == code || bytes.Contains(sealed, []byte(made.Token)) || bytes.Contains(sealed, []byte(code)) {
		t.Error("the row holds the code or the token in the clear")
	}
	if _, err := st.OpenAccess(ctx, code+"x"); !errors.Is(err, ErrNotFound) {
		t.Errorf("a wrong code = %v, want not found", err)
	}
}

// Revoked in Settings, a link's token is gone, and so is the link.
func TestARevokedTokensLinkOpensNothing(t *testing.T) {
	st, p, project, _ := accessFixture(t)
	ctx := context.Background()
	code, made, err := st.CreateAccess(ctx, p.ID, project, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.RevokeToken(ctx, p.ID, made.TokenID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.OpenAccess(ctx, code); !errors.Is(err, ErrNotFound) {
		t.Errorf("open after revoking = %v, want not found", err)
	}
}

// A group from another project, or none at all, is refused rather than ignored.
func TestAccessForAGroupElsewhereIsRefused(t *testing.T) {
	st, p, project, _ := accessFixture(t)
	if _, _, err := st.CreateAccess(context.Background(), p.ID, project, "gr_nothing"); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v, want not found", err)
	}
}

// Narrowed from the link's dialog, revoked from Settings: still not content, still no backup.
func TestChangingAnAccessTokenIsNotAChangeEither(t *testing.T) {
	st, p, project, _ := accessFixture(t)
	ctx := context.Background()
	code, made, err := st.CreateAccess(ctx, p.ID, project, "")
	if err != nil {
		t.Fatal(err)
	}
	before := st.Changes()
	rows := []TokenProject{{ProjectID: project, Scope: "and(garden)"}}
	if _, err := st.UpdateToken(ctx, p.ID, made.TokenID, TokenChange{Projects: &rows}); err != nil {
		t.Fatal(err)
	}
	got, err := st.OpenAccess(ctx, code)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Reach) != 1 || got.Reach[0].Scope != "garden" {
		t.Errorf("reach = %+v, want the narrowed scope", got.Reach)
	}
	if err := st.RevokeToken(ctx, p.ID, made.TokenID); err != nil {
		t.Fatal(err)
	}
	if after := st.Changes(); after != before {
		t.Errorf("changes went from %d to %d", before, after)
	}
}
