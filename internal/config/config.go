// Package config is the environment, parsed once. See docs/deploy.md.
package config

import (
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strings"
)

// Environment variables read by this package.
const (
	// PublicURLEnv is the address a browser opens. Required, and never inferred: Host and
	// X-Forwarded-Host are client-supplied, so a link built from one is a link a stranger
	// controls.
	//
	// It decides the cookie's Secure flag, invitation links, recovery mail, and the base URL
	// /docs hands an agent.
	PublicURLEnv = "TASKIO_PUBLIC_URL"

	// DataDirEnv is where taskio.db lives.
	DataDirEnv = "TASKIO_DATA_DIR"

	// LogLevelEnv sets the slog level: debug, info, warn or error.
	LogLevelEnv = "TASKIO_LOG_LEVEL"

	// BackupURLEnv is the agent's POST endpoint, whole address rather than a host: the path
	// is the agent's to name. Unset, nothing is backed up.
	BackupURLEnv = "TASKIO_BACKUP_URL"
)

// Defaults for everything that has one.
const DefaultDataDir = "/data"

// Config is everything the process was told at startup.
type Config struct {
	// PublicURL is normalised: lowercased, no trailing slash, no path, query or fragment.
	PublicURL *url.URL

	DataDir  string
	LogLevel slog.Level

	// Secure is PublicURL being https, derived once rather than at each Set-Cookie.
	Secure bool

	// BackupURL is where an archive is posted, or empty for no backups at all.
	BackupURL string
}

// Link builds an absolute URL into this instance.
func (c *Config) Link(path string) string {
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return c.PublicURL.String() + path
}

// Load reads the environment. Errors are written for somebody looking at a container that
// refused to start.
func Load() (*Config, error) {
	raw := strings.TrimSpace(os.Getenv(PublicURLEnv))
	if raw == "" {
		return nil, fmt.Errorf("%s is required: set it to the address you open in a browser, e.g. https://taskio.example.com", PublicURLEnv)
	}
	public, err := parsePublicURL(raw)
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		PublicURL: public,
		DataDir:   DefaultDataDir,
		LogLevel:  slog.LevelInfo,
		Secure:    public.Scheme == "https",
	}
	if dir := strings.TrimSpace(os.Getenv(DataDirEnv)); dir != "" {
		cfg.DataDir = dir
	}
	cfg.BackupURL = strings.TrimSpace(os.Getenv(BackupURLEnv))

	// A startup error rather than a fall back to info: a level that quietly works is one
	// nobody finds until the log lacks what they came for.
	if v := strings.TrimSpace(os.Getenv(LogLevelEnv)); v != "" {
		if err := cfg.LogLevel.UnmarshalText([]byte(strings.ToLower(v))); err != nil {
			return nil, fmt.Errorf("%s: %q is not a level (debug, info, warn, error)", LogLevelEnv, v)
		}
	}
	return cfg, nil
}

// parsePublicURL validates and normalises.
//
// A trailing slash is trimmed: it is the commonest way to write one down. A path is refused —
// taskio serves from the root, and a prefix would produce links that half work.
func parsePublicURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("%s: %q is not a URL: %w", PublicURLEnv, raw, err)
	}
	u.Scheme = strings.ToLower(u.Scheme)
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("%s: %q needs an http:// or https:// scheme", PublicURLEnv, raw)
	}
	if u.Host == "" {
		return nil, fmt.Errorf("%s: %q names no host", PublicURLEnv, raw)
	}
	u.Host = strings.ToLower(u.Host)
	if u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("%s: %q should be a scheme and a host, with no query or fragment", PublicURLEnv, raw)
	}
	if p := strings.Trim(u.Path, "/"); p != "" {
		return nil, fmt.Errorf("%s: %q has a path in it, and taskio serves from the root", PublicURLEnv, raw)
	}
	u.Path = ""
	u.User = nil
	return u, nil
}
