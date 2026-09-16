package cli

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"taskio/internal/api"
	"taskio/internal/app"
	"taskio/internal/backup"
	"taskio/internal/config"
	"taskio/internal/store"
	"taskio/internal/sweep"
)

// firstRun prints an invitation when the instance has no administrator.
func firstRun(ctx context.Context, cfg *config.Config, st *store.Store, log *slog.Logger) error {
	has, err := st.HasAdmin(ctx)
	if err != nil || has {
		return err
	}
	inv, token, err := st.CreateInvite(ctx, "", store.RoleAdmin)
	if err != nil {
		return err
	}
	log.Info("no administrator yet; open this link to make one", "expires_at", inv.ExpiresAt.Format(time.RFC3339))
	fmt.Println(cfg.Link("/invite/" + token))
	return nil
}

func serveCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "serve",
		Short: "Run the server",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, st, log, err := setup()
			if err != nil {
				return err
			}
			defer st.Close()

			// Said at startup so "it works locally" does not become how it is deployed.
			if cfg.PublicURL.Scheme != "https" {
				log.Warn("public url is http, so the session cookie ships without Secure",
					"url", cfg.PublicURL.String())
			}

			// Read once. A missing directory is the same as an empty one.
			// One directory, read once, serving both the bundle and the docs page built
			// beside it.
			webDir := app.WebDir
			if _, err := os.Stat(webDir); err != nil {
				webDir = "web/dist"
			}
			var webFS fs.FS
			if _, err := os.Stat(webDir); err == nil {
				webFS = os.DirFS(webDir)
			} else {
				log.Warn("no web directory, so the placeholder page is what a browser gets",
					"dir", app.WebDir)
			}
			spa, err := api.NewSPA(webFS)
			if err != nil {
				return err
			}

			// No administrator yet means no way in, so serve prints one. No default password
			// exists at any point, so there is no credential for somebody to forget to change.
			if err := firstRun(cmd.Context(), cfg, st, log); err != nil {
				return err
			}

			var sourceFS fs.FS
			if _, err := os.Stat(app.DocsDir); err == nil {
				sourceFS = os.DirFS(app.DocsDir)
			} else if _, err := os.Stat("docs"); err == nil {
				sourceFS = os.DirFS("docs")
			}
			docs := api.NewDocs(webFS, sourceFS, cfg.PublicURL.String())

			ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
			defer stop()

			// Every request is built on this one, so cancelling it ends the streams that are
			// waiting for something to happen. Shutdown waits for what is in flight, and an
			// event stream is in flight until the browser closes the tab — without this, a
			// deploy spends the whole shutdown timeout waiting for somebody to go home.
			streams, endStreams := context.WithCancel(context.Background())
			defer endStreams()

			srv := &http.Server{
				Addr:              app.ListenAddr,
				Handler:           api.New(cfg, log, st, spa, docs),
				ReadHeaderTimeout: 10 * time.Second,
				BaseContext:       func(net.Listener) context.Context { return streams },
			}

			// Waited on below, so neither is still writing when the database closes.
			var background sync.WaitGroup
			for _, loop := range []func(){
				func() { sweep.Run(ctx, st, log) },
				func() { backup.Run(ctx, st, cfg.BackupURL, cfg.DataDir, log) },
			} {
				background.Add(1)
				go func() {
					defer background.Done()
					loop()
				}()
			}

			errc := make(chan error, 1)
			go func() {
				log.Info("listening", "addr", app.ListenAddr, "version", app.Version,
					"url", cfg.PublicURL.String(), "data", cfg.DataDir)
				errc <- srv.ListenAndServe()
			}()

			select {
			case err := <-errc:
				if errors.Is(err, http.ErrServerClosed) {
					return nil
				}
				return err
			case <-ctx.Done():
				// Bounded, or one slow request costs the full kill timeout every deploy.
				shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				log.Info("shutting down")
				// Before Shutdown rather than after: it waits for active requests, and a
				// stream only stops being active when its context ends.
				endStreams()
				err := srv.Shutdown(shutdown)
				// Before the deferred Close, or a sweep mid-pass writes into a database that is
				// being checkpointed.
				background.Wait()
				return err
			}
		},
	}
}
