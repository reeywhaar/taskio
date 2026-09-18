// Package backup snapshots the database and posts it to an agent.
//
// taskio holds no credential, no provider, no bucket and no retention policy: it decides when
// to back up and what goes in the archive, and everything after that is the agent's. A
// compromised container cannot read, overwrite or delete a single existing backup, because it
// has nothing to authenticate with and nothing to point at.
package backup

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"taskio/internal/app"
	"taskio/internal/store"
)

// Interval is how often the loop looks, which is also a throttle: an afternoon of writing things
// down is a handful of archives rather than one per thought.
//
// Half an hour rather than five minutes. The loop sends nothing when nothing was written — that
// part was already true — so the cost of the shorter interval was never wasted uploads; it was
// how finely an instance somebody is actually using peppers the agent, and half an hour is the
// most anybody stands to lose.
const Interval = 30 * time.Minute

// uploadTimeout bounds one attempt, so a slow agent cannot stall the loop indefinitely.
const uploadTimeout = 10 * time.Minute

// Run posts an archive whenever the content has meaningfully changed.
//
// Nothing else makes a copy happen: no timer, no heartbeat, no floor. An instance nobody has
// touched since Tuesday sends nothing, and liveness is /healthz's job.
func Run(ctx context.Context, st *store.Store, url, dataDir string, log *slog.Logger) {
	if url == "" {
		return
	}
	ticker := time.NewTicker(Interval)
	defer ticker.Stop()

	// A restart sends one: a process that has just started may be on a volume nobody has a
	// copy of yet.
	var sent uint64
	first := true

	for {
		if changes := st.Changes(); first || changes != sent {
			if err := send(ctx, st, url, dataDir, log); err != nil {
				log.Error("backup failed", "err", err)
			} else {
				sent = changes
				first = false
				log.Info("backup sent", "changes", changes)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func send(ctx context.Context, st *store.Store, url, dataDir string, log *slog.Logger) error {
	dir, err := os.MkdirTemp(dataDir, "backup-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)

	snapshot := filepath.Join(dir, store.FileName)
	if err := st.SnapshotTo(ctx, snapshot); err != nil {
		return err
	}
	archive, err := pack(snapshot)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, uploadTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(archive))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/gzip")
	req.Header.Set("User-Agent", app.Name+"/"+app.Version)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("the agent answered %s", resp.Status)
	}
	return nil
}

// pack writes the snapshot as a gzipped tar.
//
// Level 1: most of the bytes are already-compressed images, so levels above it spend CPU
// proportional to the file for a percent or two — and the one thing that must not happen is a
// pass long enough to overlap the next one.
//
// Members are mode 0600 and there are no directory entries, so extracting cannot re-chmod a
// data directory that already exists.
func pack(path string) ([]byte, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var out bytes.Buffer
	gz, err := gzip.NewWriterLevel(&out, gzip.BestSpeed)
	if err != nil {
		return nil, err
	}
	tw := tar.NewWriter(gz)
	if err := tw.WriteHeader(&tar.Header{
		Name:    store.FileName,
		Mode:    0o600,
		Size:    int64(len(body)),
		ModTime: time.Now().UTC(),
	}); err != nil {
		return nil, err
	}
	if _, err := tw.Write(body); err != nil {
		return nil, err
	}
	if err := tw.Close(); err != nil {
		return nil, err
	}
	if err := gz.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
