package api

import (
	"io"
	"net/http"
	"strconv"

	"taskio/internal/store"
)

// assetBodyMax bounds what is read before the size is known. The refusal a caller gets names
// the instance's own limit rather than this.
const assetBodyMax = 64 << 20

// putAsset takes the bytes as the raw request body.
//
// Not multipart: there is one file and no fields, and a paste handler assembling a multipart
// body is thirty lines that do nothing.
func (s *Server) putAsset(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, assetBodyMax))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	asset, err := s.store.PutAsset(r.Context(), principalOf(r).ID, r.Header.Get("Content-Type"), body)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":           asset.ID,
		"url":          asset.URL(),
		"content_type": asset.ContentType,
		"size":         asset.Size,
		// So a client knows whether to embed it or link to it, rather than guessing from the
		// type it happened to send.
		"image": store.IsImage(asset.ContentType),
	})
}

// getAsset serves one, scoped to its owner.
//
// The headers are belt and braces against the allowlist and the sniff both being wrong: a file
// endpoint on the same origin as the app is the classic way a stored XSS arrives.
//
// Disposition is per type rather than always inline: an image or a PDF is meant to be looked at,
// and everything else is handed over as a download, because a browser that decides for itself
// what a .txt is has to be told not to.
func (s *Server) getAsset(w http.ResponseWriter, r *http.Request) {
	asset, err := s.store.Asset(r.Context(), principalOf(r).ID, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	etag := `"` + hexOf(asset.SHA256[:16]) + `"`
	// Content is addressed by hash, so a stored asset never changes.
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	body, err := s.store.AssetBytes(r.Context(), asset.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.Header().Set("Content-Type", asset.ContentType)
	w.Header().Set("Content-Length", strconv.FormatInt(asset.Size, 10))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition", string(store.DispositionOf(asset.ContentType)))
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Write(body)
}

const hexDigits = "0123456789abcdef"

func hexOf(b []byte) string {
	out := make([]byte, len(b)*2)
	for i, c := range b {
		out[i*2] = hexDigits[c>>4]
		out[i*2+1] = hexDigits[c&0xf]
	}
	return string(out)
}
