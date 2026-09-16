package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// How the connection to a relay is encrypted. There is no third option: a password crossing
// the network in the clear is not a choice somebody should be able to make by accident.
const (
	SecurityStartTLS = "starttls"
	SecurityImplicit = "implicit"
)

// Relay is where mail is handed over.
type Relay struct {
	Host        string
	Port        int
	Security    string
	Username    string
	Password    string
	FromAddress string
	FromName    string
}

// Configured reports whether there is a relay at all.
func (r *Relay) Configured() bool { return r != nil && r.Host != "" }

// Relay reads the instance's, or nil.
func (s *Store) Relay(ctx context.Context) (*Relay, error) {
	r := &Relay{}
	err := s.reader.QueryRowContext(ctx,
		`SELECT host, port, security, username, password, from_address, from_name
		   FROM smtp WHERE singleton = 1`).
		Scan(&r.Host, &r.Port, &r.Security, &r.Username, &r.Password, &r.FromAddress, &r.FromName)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("relay: %w", err)
	}
	return r, nil
}

// SetRelay writes it.
//
// An empty password keeps the stored one, which is what lets somebody correct a port without
// retyping a credential the form was never given.
func (s *Store) SetRelay(ctx context.Context, r Relay) error {
	r.Host = strings.TrimSpace(r.Host)
	switch {
	case r.Host == "":
		return Invalid("A relay needs a host.")
	case r.Port < 1 || r.Port > 65535:
		return Invalid("A port is between 1 and 65535.")
	case r.Security != SecurityStartTLS && r.Security != SecurityImplicit:
		return Invalid("Encryption is starttls or implicit.")
	case strings.TrimSpace(r.FromAddress) == "":
		return Invalid("A relay needs an address to send from.")
	}
	// Accepting one without the other would make "this relay needs no authentication"
	// indistinguishable from "somebody left the field empty", and the second is far likelier.
	if (r.Username == "") != (r.Password == "") {
		existing, err := s.Relay(ctx)
		if err != nil {
			return err
		}
		if r.Password == "" && existing != nil && existing.Username == r.Username {
			r.Password = existing.Password
		} else {
			return Invalid("Give a username and a password, or neither.")
		}
	}

	_, err := s.writer.ExecContext(ctx,
		`INSERT INTO smtp (singleton, host, port, security, username, password, from_address, from_name)
		 VALUES (1, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (singleton) DO UPDATE SET
		   host = excluded.host, port = excluded.port, security = excluded.security,
		   username = excluded.username, password = excluded.password,
		   from_address = excluded.from_address, from_name = excluded.from_name`,
		r.Host, r.Port, r.Security, r.Username, r.Password, r.FromAddress, r.FromName)
	if err != nil {
		return fmt.Errorf("set relay: %w", err)
	}
	s.changed()
	return nil
}

// DeleteRelay forgets it.
func (s *Store) DeleteRelay(ctx context.Context) error {
	if _, err := s.writer.ExecContext(ctx, `DELETE FROM smtp WHERE singleton = 1`); err != nil {
		return err
	}
	s.changed()
	return nil
}
