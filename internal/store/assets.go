package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"taskio/internal/ids"
)

// AssetTypes is what may be uploaded, and how each one is served.
//
// The list is an allowlist rather than a denylist, because the question is not "is this
// dangerous" — which nobody can answer for every type there will ever be — but "is this one of
// the handful this product carries".
//
// Nothing that a browser will execute on this origin. SVG is refused by name because it is an
// image format that runs script, and HTML is not on the list at all: serving either from here
// would put script on the same origin as the session cookie.
var AssetTypes = map[string]Disposition{
	"image/png":       Inline,
	"image/jpeg":      Inline,
	"image/gif":       Inline,
	"image/webp":      Inline,
	"image/avif":      Inline,
	"application/pdf": Inline,

	// Text is served as a download rather than shown: a browser sniffing a .txt into something
	// it will render is the whole reason nosniff exists, and an attachment cannot be the page.
	"text/plain":       Attachment,
	"text/markdown":    Attachment,
	"text/csv":         Attachment,
	"application/json": Attachment,
	"application/zip":  Attachment,
}

// Disposition is whether a browser may show an asset or must save it.
type Disposition string

const (
	Inline     Disposition = "inline"
	Attachment Disposition = "attachment"
)

// DispositionOf is how this type is served. Unknown types never reach here.
func DispositionOf(kind string) Disposition {
	if d, ok := AssetTypes[kind]; ok {
		return d
	}
	return Attachment
}

// IsImage reports whether a description should embed this rather than link to it.
func IsImage(kind string) bool { return strings.HasPrefix(kind, "image/") }

// assetTypeNames is the allowlist as a sentence, for a refusal that has to name it.
func assetTypeNames() string {
	names := make([]string, 0, len(AssetTypes))
	for kind := range AssetTypes {
		names = append(names, kind)
	}
	sort.Strings(names)
	return strings.Join(names, ", ")
}

// Asset is an image, without its bytes.
type Asset struct {
	ID          string
	PrincipalID string
	ContentType string
	Size        int64
	SHA256      []byte
	CreatedAt   time.Time
}

// URL is where the asset is served, and what goes into a description.
func (a *Asset) URL() string { return "/api/assets/" + a.ID }

// PutAsset stores an image, or returns the one already holding those bytes.
//
// Dedup is per account and never global: sharing a blob between accounts would mean one
// person's delete reaching another's task, and the storage saved is not worth that sentence
// existing.
func (s *Store) PutAsset(ctx context.Context, principalID, declared string, body []byte) (*Asset, error) {
	limits, err := s.Limits(ctx)
	if err != nil {
		return nil, err
	}
	kind, err := assetType(declared, body)
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limits.AssetMaxBytes {
		return nil, tooLarge("This instance takes files up to %s.", bytesName(limits.AssetMaxBytes))
	}

	sum := sha256.Sum256(body)
	if existing, err := s.assetByContent(ctx, principalID, sum[:]); err == nil {
		return existing, nil
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	used, err := s.AssetUsage(ctx, principalID)
	if err != nil {
		return nil, err
	}
	if used+int64(len(body)) > limits.AccountQuotaBytes {
		return nil, tooLarge("That would put this account over its %s of storage.",
			bytesName(limits.AccountQuotaBytes))
	}

	now := s.Now()
	asset := &Asset{
		ID:          ids.New(ids.Asset, now.UnixMilli()),
		PrincipalID: principalID,
		ContentType: kind,
		Size:        int64(len(body)),
		SHA256:      sum[:],
		CreatedAt:   now,
	}

	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO assets (id, principal_id, sha256, content_type, size, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		asset.ID, principalID, asset.SHA256, kind, asset.Size, unix(now)); err != nil {
		return nil, fmt.Errorf("put asset: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO asset_blobs (asset_id, bytes) VALUES (?, ?)`, asset.ID, body); err != nil {
		return nil, fmt.Errorf("put asset: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	s.changed()
	return asset, nil
}

// Asset returns one, scoped to its owner. The reference in a description never grants access —
// otherwise pasting somebody else's asset URL would grant you their image.
func (s *Store) Asset(ctx context.Context, principalID, id string) (*Asset, error) {
	a := &Asset{}
	var created int64
	err := s.reader.QueryRowContext(ctx,
		`SELECT id, principal_id, content_type, size, sha256, created_at
		   FROM assets WHERE id = ? AND principal_id = ?`, id, principalID).
		Scan(&a.ID, &a.PrincipalID, &a.ContentType, &a.Size, &a.SHA256, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, NotFound("There is no such image.")
	}
	if err != nil {
		return nil, fmt.Errorf("asset: %w", err)
	}
	a.CreatedAt = time.Unix(created, 0).UTC()
	return a, nil
}

// AssetBytes reads one blob. Bounded by the per-image cap, which is what makes reading it whole
// acceptable.
func (s *Store) AssetBytes(ctx context.Context, id string) ([]byte, error) {
	var body []byte
	err := s.reader.QueryRowContext(ctx,
		`SELECT bytes FROM asset_blobs WHERE asset_id = ?`, id).Scan(&body)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, NotFound("There is no such image.")
	}
	return body, err
}

// AssetUsage is what an account holds, summed from the size column rather than from length() on
// a blob, which SQLite answers by reading it.
func (s *Store) AssetUsage(ctx context.Context, principalID string) (int64, error) {
	var total int64
	err := s.reader.QueryRowContext(ctx,
		`SELECT coalesce(sum(size), 0) FROM assets WHERE principal_id = ?`, principalID).Scan(&total)
	return total, err
}

func (s *Store) assetByContent(ctx context.Context, principalID string, sum []byte) (*Asset, error) {
	a := &Asset{PrincipalID: principalID, SHA256: sum}
	var created int64
	err := s.reader.QueryRowContext(ctx,
		`SELECT id, content_type, size, created_at FROM assets
		  WHERE principal_id = ? AND sha256 = ?`, principalID, sum).
		Scan(&a.ID, &a.ContentType, &a.Size, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	a.CreatedAt = time.Unix(created, 0).UTC()
	return a, nil
}

// assetType checks what was declared against what the bytes are.
//
// A file's claim about itself is not evidence, so both have to agree.
func assetType(declared string, body []byte) (string, error) {
	declared = strings.TrimSpace(strings.ToLower(declared))
	if i := strings.IndexByte(declared, ';'); i >= 0 {
		declared = strings.TrimSpace(declared[:i])
	}
	switch declared {
	case "image/svg+xml":
		return "", Invalid("SVG is refused here: it is an image format that runs script.")
	case "text/html", "application/xhtml+xml":
		return "", Invalid("HTML is refused here: it would run script on this origin.")
	}
	if _, ok := AssetTypes[declared]; !ok {
		return "", Invalid("This takes %s.", assetTypeNames())
	}
	if !sniffs(declared, body) {
		return "", Invalid("Those bytes are not %s.", declared)
	}
	return declared, nil
}

// sniffs checks the bytes against what was declared, because a file's claim about itself is not
// evidence.
//
// http.DetectContentType follows the WHATWG list, which is why two types need their own check:
// AVIF is not in it at all and sniffs as application/octet-stream, and every text type sniffs as
// text/plain, so markdown and CSV cannot be told apart by it.
//
// What matters for the text family is not which of them it is — they are all served as a
// download — but that it is text rather than something a browser would execute.
func sniffs(declared string, body []byte) bool {
	got := http.DetectContentType(body)
	if i := strings.IndexByte(got, ';'); i >= 0 {
		got = strings.TrimSpace(got[:i])
	}
	switch declared {
	case "image/avif":
		return isAVIF(body)
	case "text/plain", "text/markdown", "text/csv", "application/json":
		return strings.HasPrefix(got, "text/")
	}
	return got == declared
}

func isAVIF(body []byte) bool {
	if len(body) < 12 || string(body[4:8]) != "ftyp" {
		return false
	}
	switch string(body[8:12]) {
	case "avif", "avis":
		return true
	}
	return false
}

// tooLarge is a refusal that names the limit, because one a caller cannot act on is a bug.
func tooLarge(format string, a ...any) error {
	return &classified{kind: ErrTooLarge, msg: fmt.Sprintf(format, a...)}
}

func bytesName(n int64) string {
	switch {
	case n >= 1<<30:
		return fmt.Sprintf("%d GB", n>>30)
	case n >= 1<<20:
		return fmt.Sprintf("%d MB", n>>20)
	}
	return fmt.Sprintf("%d bytes", n)
}
