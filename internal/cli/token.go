package cli

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"taskio/internal/store"
)

// tokenCmd exists so wiring up an agent is one line on the machine that is already open.
//
// The route through the app — sign in, find settings, find tokens, mint, copy — is the one
// people skip in favour of something worse, like handing a script their session cookie.
func tokenCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "token", Short: "Mint, list and revoke API tokens"}
	cmd.AddCommand(tokenCreateCmd(), tokenListCmd(), tokenRevokeCmd())
	return cmd
}

func tokenCreateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Mint a token and print it once",
		RunE: func(cmd *cobra.Command, _ []string) error {
			_, st, _, err := setup()
			if err != nil {
				return err
			}
			defer st.Close()

			user, _ := cmd.Flags().GetString("user")
			label, _ := cmd.Flags().GetString("label")
			scope, _ := cmd.Flags().GetString("scope")
			expires, _ := cmd.Flags().GetString("expires")

			p, err := principalNamed(cmd.Context(), st, user)
			if err != nil {
				return err
			}
			var at *time.Time
			if expires != "" {
				d, err := time.ParseDuration(expires)
				if err != nil || d <= 0 {
					return fmt.Errorf("--expires wants a duration like 720h")
				}
				t := st.Now().Add(d)
				at = &t
			}

			var idleFor time.Duration
			if idle, _ := cmd.Flags().GetString("idle"); idle != "" {
				d, err := time.ParseDuration(idle)
				if err != nil || d <= 0 {
					return fmt.Errorf("--idle wants a duration like 720h")
				}
				idleFor = d
			}

			tok, secret, err := st.CreateToken(cmd.Context(), p.ID, label, scope, at, idleFor)
			if err != nil {
				return err
			}
			// Printed once and never again, which is said on the line above it.
			cmd.PrintErrln("This is the only time this token is shown.")
			cmd.Println(secret)
			cmd.PrintErrf("id %s", tok.ID)
			if tok.Scope != "" {
				cmd.PrintErrf("  scope %s", tok.Scope)
			}
			if at != nil {
				cmd.PrintErrf("  expires %s", at.Format(time.RFC3339))
			}
			cmd.PrintErrln()
			return nil
		},
	}
	cmd.Flags().String("user", "", "the account it belongs to")
	cmd.Flags().String("label", "", "what it is for")
	cmd.Flags().String("scope", "", "confine it, e.g. and(work)")
	cmd.Flags().String("expires", "", "how long it lasts, e.g. 720h")
	cmd.Flags().String("idle", "", "retire it after this long unused, e.g. 168h")
	cmd.MarkFlagRequired("user")
	cmd.MarkFlagRequired("label")
	return cmd
}

func tokenListCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List an account's tokens",
		RunE: func(cmd *cobra.Command, _ []string) error {
			_, st, _, err := setup()
			if err != nil {
				return err
			}
			defer st.Close()

			user, _ := cmd.Flags().GetString("user")
			p, err := principalNamed(cmd.Context(), st, user)
			if err != nil {
				return err
			}
			list, err := st.Tokens(cmd.Context(), p.ID)
			if err != nil {
				return err
			}
			now := st.Now()
			for _, tok := range list {
				state := "live"
				switch {
				case tok.RevokedAt != nil:
					state = "revoked"
				case !tok.Live(now):
					state = "expired"
				}
				cmd.Printf("%s  %-20s %-8s %s\n", tok.ID, tok.Label, state, tok.Scope)
			}
			return nil
		},
	}
	cmd.Flags().String("user", "", "the account")
	cmd.MarkFlagRequired("user")
	return cmd
}

func tokenRevokeCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "revoke <id>",
		Short: "Revoke a token by its id",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			_, st, _, err := setup()
			if err != nil {
				return err
			}
			defer st.Close()

			user, _ := cmd.Flags().GetString("user")
			p, err := principalNamed(cmd.Context(), st, user)
			if err != nil {
				return err
			}
			return st.RevokeToken(cmd.Context(), p.ID, args[0])
		},
	}
	cmd.Flags().String("user", "", "the account")
	cmd.MarkFlagRequired("user")
	return cmd
}

// principalNamed finds an account by username.
func principalNamed(ctx context.Context, st *store.Store, username string) (*store.Principal, error) {
	p, err := st.PrincipalNamed(ctx, strings.TrimSpace(username))
	if err != nil {
		return nil, fmt.Errorf("no account called %q", username)
	}
	return p, nil
}
