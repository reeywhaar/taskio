package api

import (
	"sync"
	"time"
)

// limiter is a token bucket per key.
//
// It lives on the Server rather than at package level: two instances in one process — which is
// what a test suite is — would otherwise share one budget and lock each other out.
type limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    time.Duration
	burst   int
	now     func() time.Time
}

type bucket struct {
	tokens float64
	last   time.Time
}

func newLimiter(burst int, per time.Duration) *limiter {
	return &limiter{
		buckets: map[string]*bucket{},
		rate:    per,
		burst:   burst,
		now:     time.Now,
	}
}

// allow reports whether key may proceed, and spends a token if so.
func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	b := l.buckets[key]
	if b == nil {
		b = &bucket{tokens: float64(l.burst), last: now}
		l.buckets[key] = b
	}
	b.tokens += now.Sub(b.last).Seconds() / l.rate.Seconds()
	if b.tokens > float64(l.burst) {
		b.tokens = float64(l.burst)
	}
	b.last = now

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// sweep drops buckets nobody has touched, so a long-running process does not accumulate one
// per username anybody has ever guessed at.
func (l *limiter) sweep() {
	l.mu.Lock()
	defer l.mu.Unlock()
	cutoff := l.now().Add(-time.Hour)
	for k, b := range l.buckets {
		if b.last.Before(cutoff) {
			delete(l.buckets, k)
		}
	}
}
