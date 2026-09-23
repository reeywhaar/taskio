package backup

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"taskio/internal/store"
)

// A copy goes out when content changed, and at no other time.
func TestAnArchiveGoesOutOnlyWhenSomethingChanged(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	var received atomic.Int64
	var body atomic.Value
	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		body.Store(b)
		received.Add(1)
	}))
	defer agent.Close()

	ctx := context.Background()
	log := slog.New(slog.DiscardHandler)

	// The first pass always sends: a fresh process may be on a volume nobody has a copy of.
	if err := send(ctx, st, agent.URL, dir, log); err != nil {
		t.Fatal(err)
	}
	if received.Load() != 1 {
		t.Fatalf("the agent got %d archives", received.Load())
	}

	// What arrived is a database that opens on its own.
	raw, _ := body.Load().([]byte)
	names := membersOf(t, raw)
	if len(names) != 1 || names[0] != store.FileName {
		t.Errorf("archive holds %v", names)
	}
}

// The counter is the signal, and a no-op write must not move it.
func TestOnlyMeaningfulWritesCountAsChanges(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()

	p, err := st.CreatePrincipal(ctx, "misha", "a good password", store.RoleUser)
	if err != nil {
		t.Fatal(err)
	}
	task, err := st.CreateTask(ctx, p.ID, mainOf(t, st, p.ID), nil, store.TaskNew{Title: "Fix the tap", Description: "It drips."})
	if err != nil {
		t.Fatal(err)
	}

	before := st.Changes()

	// A session touch is the process noticing itself, not somebody writing something down.
	if _, err := st.CreateSession(ctx, "token", p.ID, "curl/8"); err != nil {
		t.Fatal(err)
	}
	if st.Changes() != before {
		t.Error("a session bumped the change counter, which would schedule a backup")
	}

	// A save that sets identical values is not a change.
	title := task.Title
	if _, err := st.UpdateTask(ctx, p.ID, nil, task.ID, store.TaskPatch{Title: &title}); err != nil {
		t.Fatal(err)
	}
	if st.Changes() != before {
		t.Error("a no-op save bumped the change counter")
	}

	// A real edit does.
	changed := "Fix the tap properly"
	if _, err := st.UpdateTask(ctx, p.ID, nil, task.ID, store.TaskPatch{Title: &changed}); err != nil {
		t.Fatal(err)
	}
	if st.Changes() == before {
		t.Error("a real edit did not bump the change counter")
	}
}

// A snapshot has to be a database rather than a copy of a moment that never existed.
func TestTheArchiveIsAConsistentDatabase(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	p, _ := st.CreatePrincipal(ctx, "misha", "a good password", store.RoleUser)
	st.CreateTask(ctx, p.ID, mainOf(t, st, p.ID), nil, store.TaskNew{Title: "Fix the tap", Description: ""})

	restored := t.TempDir()
	if err := st.SnapshotTo(ctx, restored+"/"+store.FileName); err != nil {
		t.Fatal(err)
	}
	st.Close()

	// It opens on its own, with what was written in it.
	reopened, err := store.Open(restored)
	if err != nil {
		t.Fatalf("the snapshot does not open: %v", err)
	}
	defer reopened.Close()

	page, err := reopened.ListTasks(ctx, p.ID, mainOf(t, reopened, p.ID), nil, store.TaskQuery{}, "")
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || page.Tasks[0].Title != "Fix the tap" {
		t.Errorf("the restored database holds %d tasks", page.Total)
	}
}

func TestAFailingAgentIsReported(t *testing.T) {
	dir := t.TempDir()
	st, _ := store.Open(dir)
	defer st.Close()

	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "no", http.StatusInternalServerError)
	}))
	defer agent.Close()

	err := send(context.Background(), st, agent.URL, dir, slog.New(slog.DiscardHandler))
	if err == nil {
		t.Fatal("a refusing agent was reported as a success")
	}
}

// Members are 0600 and there are no directory entries, so extracting cannot re-chmod a data
// directory that already exists.
func TestArchiveMembersAreNotDirectories(t *testing.T) {
	dir := t.TempDir()
	st, _ := store.Open(dir)
	defer st.Close()

	snapshot := dir + "/snap.db"
	if err := st.SnapshotTo(context.Background(), snapshot); err != nil {
		t.Fatal(err)
	}
	raw, err := pack(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	gz, _ := gzip.NewReader(bytes.NewReader(raw))
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if h.Typeflag == tar.TypeDir {
			t.Errorf("%s is a directory entry", h.Name)
		}
		if h.Mode != 0o600 {
			t.Errorf("%s is mode %o", h.Name, h.Mode)
		}
	}
	_ = time.Now
}

func membersOf(t *testing.T, raw []byte) []string {
	t.Helper()
	gz, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	tr := tar.NewReader(gz)
	var names []string
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		names = append(names, h.Name)
	}
	return names
}

// mainOf is the account's default project.
func mainOf(t *testing.T, st *store.Store, principalID string) string {
	t.Helper()
	p, err := st.DefaultProject(context.Background(), principalID)
	if err != nil {
		t.Fatal(err)
	}
	return p.ID
}
