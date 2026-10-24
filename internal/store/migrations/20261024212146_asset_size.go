package migrations

import (
	"context"
	"database/sql"

	"taskio/internal/imagesize"
)

// How big each image is meant to be drawn: its pixels, and how many of them make a point.
//
// A browser draws an <img> a pixel for a pixel, so a screenshot from a Retina screen came out
// twice the size it was taken at. Read from the bytes already stored, which is why this is Go
// and not SQL; 0 by 0 is an image it could not read, drawn as the browser would.
var assetSize = Migration{
	Name: "20261024212146_asset_size",
	Up: func(ctx context.Context, tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `
ALTER TABLE assets ADD COLUMN width INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN height INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN scale REAL NOT NULL DEFAULT 1;
`); err != nil {
			return err
		}
		// The ids first, then each blob alone: one image's bytes in memory at a time.
		rows, err := tx.QueryContext(ctx, `SELECT id FROM assets WHERE content_type LIKE 'image/%'`)
		if err != nil {
			return err
		}
		var ids []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			ids = append(ids, id)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, id := range ids {
			var body []byte
			err := tx.QueryRowContext(ctx, `SELECT bytes FROM asset_blobs WHERE asset_id = ?`, id).Scan(&body)
			if err == sql.ErrNoRows {
				continue
			}
			if err != nil {
				return err
			}
			size, ok := imagesize.Of(body)
			if !ok {
				continue
			}
			if _, err := tx.ExecContext(ctx,
				`UPDATE assets SET width = ?, height = ?, scale = ? WHERE id = ?`,
				size.Width, size.Height, size.Scale, id); err != nil {
				return err
			}
		}
		return nil
	},
}
