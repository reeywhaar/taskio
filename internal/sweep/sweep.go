// Package sweep deletes what is due, on a timer.
//
// One ticker, each pass with its own interval, logging when it deletes something and staying
// silent when it does not.
package sweep

import (
	"context"
	"log/slog"
	"time"

	"taskio/internal/store"
)

// How often each pass runs.
const (
	// Often is for what somebody notices the lateness of: a session that should have ended,
	// a pin that should have come off.
	Often  = 10 * time.Minute
	Hourly = time.Hour
)

// Run sweeps until ctx is done.
//
// A ticker rather than a chain that reschedules itself: the spacing is identical, but a chain
// has no owner — lose the goroutine between finishing one pass and queueing the next and the
// work stops with nothing to notice.
func Run(ctx context.Context, st *store.Store, log *slog.Logger) {
	often := time.NewTicker(Often)
	defer often.Stop()
	hourly := time.NewTicker(Hourly)
	defer hourly.Stop()

	Once(ctx, st, log)
	for {
		select {
		case <-ctx.Done():
			return
		case <-often.C:
			sweepOften(ctx, st, log)
		case <-hourly.C:
			Once(ctx, st, log)
		}
	}
}

// Once runs every pass, in the order that makes them compose.
//
// Tasks go before assets: their rows take the join rows with them by cascade, so the assets
// they orphan are collected on the next pass rather than raced for in this one.
func Once(ctx context.Context, st *store.Store, log *slog.Logger) {
	sweepOften(ctx, st, log)
	run(ctx, log, "invites", st.SweepInvites)
	run(ctx, log, "recovery attempts", st.SweepRecovery)
	run(ctx, log, "recovery links", st.SweepRecoveryLinks)
	run(ctx, log, "done tasks", st.SweepDoneTasks)
	run(ctx, log, "orphaned assets", st.SweepOrphanAssets)
}

func sweepOften(ctx context.Context, st *store.Store, log *slog.Logger) {
	run(ctx, log, "expired sessions", st.SweepSessions)
	run(ctx, log, "expired pins", st.UnpinExpired)
}

func run(ctx context.Context, log *slog.Logger, what string, f func(context.Context) (int64, error)) {
	n, err := f(ctx)
	switch {
	case err != nil:
		log.Error("sweep failed", "what", what, "err", err)
	case n > 0:
		log.Info("swept", "what", what, "count", n)
	}
}
