package migrations

import (
	"bytes"
	"context"
	"database/sql"
	"image"
	"image/png"
	"path/filepath"
	"testing"
)

// Images stored before sizes were are read once, from their bytes: a Retina screenshot gets its
// pixels and scale 2, and what is not an image keeps nothing.
func TestStoredImagesAreMeasured(t *testing.T) {
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "t.db")+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	runUpTo(t, db, "20261019222059_pin_lapse")

	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 1062, 926))); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	at := 8 + 8 + 13 + 4
	phys := []byte{0, 0, 0, 9, 'p', 'H', 'Y', 's', 0, 0, 0x16, 0x25, 0, 0, 0x16, 0x25, 1, 0, 0, 0, 0}
	shot := append(append(append([]byte{}, b[:at]...), phys...), b[at:]...)

	if _, err := db.Exec(`INSERT INTO principals (id, username, password_hash, role, created_at) VALUES ('p_a', 'robin', 'x', 'admin', 1)`); err != nil {
		t.Fatal(err)
	}
	for id, row := range map[string]struct {
		kind string
		body []byte
	}{
		"a_shot": {"image/png", shot},
		"a_note": {"text/plain", []byte("Fix the tap")},
	} {
		if _, err := db.Exec(`INSERT INTO assets (id, principal_id, sha256, content_type, size, created_at) VALUES (?, 'p_a', ?, ?, ?, 1)`,
			id, []byte(id), row.kind, len(row.body)); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`INSERT INTO asset_blobs (asset_id, bytes) VALUES (?, ?)`, id, row.body); err != nil {
			t.Fatal(err)
		}
	}
	if err := Run(context.Background(), db); err != nil {
		t.Fatal(err)
	}

	for id, want := range map[string][3]float64{"a_shot": {1062, 926, 2}, "a_note": {0, 0, 1}} {
		var w, h int
		var scale float64
		if err := db.QueryRow(`SELECT width, height, scale FROM assets WHERE id = ?`, id).Scan(&w, &h, &scale); err != nil {
			t.Fatal(err)
		}
		if float64(w) != want[0] || float64(h) != want[1] || scale != want[2] {
			t.Errorf("%s = %dx%d at %v, want %v", id, w, h, scale, want)
		}
	}
}
