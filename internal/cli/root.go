// Package cli is taskio's command line: the daemon, and what an operator needs a shell for.
//
// Three jobs the API cannot do: the first way in before any account exists, a credential for
// something with no browser, and acting when the app is not answering.
package cli

import (
	"fmt"
	"log/slog"
	"os"

	"github.com/spf13/cobra"

	"taskio/internal/app"
	"taskio/internal/config"
	"taskio/internal/store"
)

func root() *cobra.Command {
	cmd := &cobra.Command{
		Use:           app.Name,
		Short:         "A task list a person and their agent can both use",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	// Cobra prints to stderr unless an output is set, which would make `link=$(taskio invite)`
	// capture nothing.
	cmd.SetOut(os.Stdout)
	cmd.AddCommand(serveCmd(), inviteCmd(), recoverCmd(), tokenCmd(), sweepCmd(), healthcheckCmd(), versionCmd())
	return cmd
}

// Execute runs the command line and returns a process exit code.
func Execute() int {
	if err := root().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, app.Name+":", err)
		return 1
	}
	return 0
}

// setup is the environment, a logger, and the database.
//
// A LevelVar rather than a fixed level, so raising it at runtime stays a one-line change.
func setup() (*config.Config, *store.Store, *slog.Logger, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, nil, nil, err
	}
	level := new(slog.LevelVar)
	level.Set(cfg.LogLevel)
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}))

	st, err := store.Open(cfg.DataDir)
	if err != nil {
		return nil, nil, nil, err
	}
	return cfg, st, log, nil
}

func versionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the version this binary was built from",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cmd.Println(app.Version)
			return nil
		},
	}
}
