package cli

import (
	"fmt"
	"net/http"
	"time"

	"github.com/spf13/cobra"

	"taskio/internal/app"
	"taskio/internal/store"
)

// inviteCmd is the way back in. The token is readable exactly once, so a lost link is reissued
// rather than recovered.
func inviteCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "invite",
		Short: "Print a new invitation link",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, st, _, err := setup()
			if err != nil {
				return err
			}
			defer st.Close()

			role, _ := cmd.Flags().GetString("role")
			inv, token, err := st.CreateInvite(cmd.Context(), "", role)
			if err != nil {
				return err
			}
			cmd.Println(cfg.Link("/invite/" + token))
			cmd.PrintErrf("expires %s\n", inv.ExpiresAt.Format(time.RFC3339))
			return nil
		},
	}
	cmd.Flags().String("role", store.RoleUser, "admin or user")
	return cmd
}

// recoverCmd is the way back in for somebody who still has the account but not the password.
//
// The one path that needs neither a working relay nor a second administrator, which is the
// state a single-admin instance lands in the moment that administrator forgets their password.
// It mints exactly what the login form's forgotten-password mail would have sent.
func recoverCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "recover <username>",
		Short: "Print a link that sets a new password on an account",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, st, _, err := setup()
			if err != nil {
				return err
			}
			defer st.Close()

			p, err := principalNamed(cmd.Context(), st, args[0])
			if err != nil {
				return err
			}
			// No author: nobody signed in issued this, and the column is a reference to an
			// account rather than a note about a shell.
			link, token, err := st.CreateRecoveryLink(cmd.Context(), p.ID, "")
			if err != nil {
				return err
			}
			// Nothing has changed yet, which is worth saying: an administrator running this
			// for somebody else has not just locked them out.
			cmd.PrintErrf("Nothing has changed yet. %s can still sign in with their old password.\n", p.Username)
			cmd.Println(cfg.Link("/recover/" + token))
			cmd.PrintErrf("expires %s\n", link.ExpiresAt.Format(time.RFC3339))
			return nil
		},
	}
	return cmd
}

// healthcheckCmd is what HEALTHCHECK runs: a second process asking the first, so the image
// needs no HTTP client and a wedged server fails it.
func healthcheckCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "healthcheck",
		Short: "Ask the running server whether it is well",
		RunE: func(cmd *cobra.Command, _ []string) error {
			client := &http.Client{Timeout: 5 * time.Second}
			resp, err := client.Get("http://127.0.0.1" + app.ListenAddr + "/healthz")
			if err != nil {
				return err
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				return fmt.Errorf("healthz answered %s", resp.Status)
			}
			return nil
		},
	}
}
