package cli

import (
	"github.com/spf13/cobra"

	"taskio/internal/sweep"
)

// sweepCmd runs by hand what the ticker runs on its own, with no shortcut of its own: one that
// took a different path would be testing the different path.
func sweepCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "sweep",
		Short: "Delete what is due now",
		RunE: func(cmd *cobra.Command, _ []string) error {
			_, st, log, err := setup()
			if err != nil {
				return err
			}
			defer st.Close()

			dry, _ := cmd.Flags().GetBool("dry-run")
			if dry {
				c, err := st.WouldSweep(cmd.Context())
				if err != nil {
					return err
				}
				cmd.Printf("expired sessions   %d\n", c.Sessions)
				cmd.Printf("expired invites    %d\n", c.Invites)
				cmd.Printf("done tasks         %d\n", c.Tasks)
				cmd.Printf("orphaned assets    %d (%d bytes)\n", c.Assets, c.Bytes)
				return nil
			}
			sweep.Once(cmd.Context(), st, log)
			return nil
		},
	}
	cmd.Flags().Bool("dry-run", false, "print what would go, and delete nothing")
	return cmd
}
