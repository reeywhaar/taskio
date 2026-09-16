// Command taskio serves a task list that a person and the model they hand it to can both use.
package main

import (
	"os"
	"time"

	"taskio/internal/cli"
)

func main() {
	// Everything stored and logged is UTC.
	time.Local = time.UTC
	os.Exit(cli.Execute())
}
