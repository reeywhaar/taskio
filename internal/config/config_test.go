package config

import (
	"log/slog"
	"testing"
)

// set clears everything this package reads, so no test passes on another's leftovers.
func set(t *testing.T, kv map[string]string) {
	t.Helper()
	for _, k := range []string{PublicURLEnv, DataDirEnv, LogLevelEnv, BackupURLEnv} {
		t.Setenv(k, "")
	}
	for k, v := range kv {
		t.Setenv(k, v)
	}
}

func TestThePublicURLIsRequired(t *testing.T) {
	set(t, nil)
	if _, err := Load(); err == nil {
		t.Fatal("started with no public url, which would leave invitation links to a guess")
	}
}

// It cannot be inferred from a request, so a bad one must fail here.
func TestThePublicURLIsValidated(t *testing.T) {
	for name, raw := range map[string]string{
		"no scheme":    "taskio.example.com",
		"wrong scheme": "ftp://taskio.example.com",
		"no host":      "https://",
		"has a path":   "https://example.com/taskio",
		"has a query":  "https://example.com?a=1",
	} {
		t.Run(name, func(t *testing.T) {
			set(t, map[string]string{PublicURLEnv: raw})
			if _, err := Load(); err == nil {
				t.Errorf("accepted %q", raw)
			}
		})
	}
}

// The commonest way to write one down.
func TestATrailingSlashIsTrimmedRatherThanRefused(t *testing.T) {
	set(t, map[string]string{PublicURLEnv: "https://Taskio.Example.com/"})
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if got := cfg.PublicURL.String(); got != "https://taskio.example.com" {
		t.Errorf("public url = %q, want it normalised and lowercased", got)
	}
	if got := cfg.Link("/invite/abc"); got != "https://taskio.example.com/invite/abc" {
		t.Errorf("link = %q, want one slash between host and path", got)
	}
}

func TestSecureFollowsTheScheme(t *testing.T) {
	set(t, map[string]string{PublicURLEnv: "http://localhost:3014"})
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Secure {
		t.Error("http public url produced a Secure cookie, which no browser would send back")
	}
}

// A level that quietly works is one nobody finds until the log lacks what they came for.
func TestAnUnrecognisedLogLevelRefusesToStart(t *testing.T) {
	set(t, map[string]string{PublicURLEnv: "https://taskio.example.com", LogLevelEnv: "verbose"})
	if _, err := Load(); err == nil {
		t.Fatal("accepted a level that is not one, and would have silently run at info")
	}
}

func TestDefaults(t *testing.T) {
	set(t, map[string]string{PublicURLEnv: "https://taskio.example.com"})
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DataDir != DefaultDataDir {
		t.Errorf("data dir = %q", cfg.DataDir)
	}
	if cfg.LogLevel != slog.LevelInfo {
		t.Errorf("level = %v, want info", cfg.LogLevel)
	}
	if cfg.BackupURL != "" {
		t.Error("backups are on by default, which posts an archive somewhere nobody named")
	}
}
