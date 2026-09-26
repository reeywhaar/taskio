package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// onePixel is a real PNG, because the sniff has to agree with what was declared.
func onePixel(t *testing.T, shade uint8) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.Set(0, 0, color.RGBA{shade, shade, shade, 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func (c *client) upload(contentType string, body []byte) *http.Response {
	c.t.Helper()
	r := httptest.NewRequest("POST", "/api/assets", bytes.NewReader(body))
	r.Header.Set("Content-Type", contentType)
	if c.cookie != nil {
		r.AddCookie(c.cookie)
	}
	w := httptest.NewRecorder()
	c.server.ServeHTTP(w, r)
	return w.Result()
}

func TestUploadingAndServingAnImage(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	body := onePixel(t, 40)

	resp := c.upload("image/png", body)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload = %s", resp.Status)
	}
	got := c.json(resp)
	url := got["url"].(string)

	served := c.do("GET", url, "")
	if served.StatusCode != http.StatusOK {
		t.Fatalf("serve = %s", served.Status)
	}
	if ct := served.Header.Get("Content-Type"); ct != "image/png" {
		t.Errorf("content type = %q", ct)
	}
	// Belt and braces against the allowlist and the sniff both being wrong.
	if served.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Error("served without nosniff")
	}
	if !strings.Contains(served.Header.Get("Content-Security-Policy"), "default-src 'none'") {
		t.Error("served without a content security policy")
	}
}

// An image format that runs script, refused by name rather than generically.
func TestSVGIsRefusedByName(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	resp := c.upload("image/svg+xml", []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`))
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %s, want 400", resp.Status)
	}
	if msg := c.json(resp)["message"].(string); !strings.Contains(strings.ToLower(msg), "svg") {
		t.Errorf("the refusal does not name SVG: %q", msg)
	}
}

// A file's claim about itself is not evidence.
func TestTheBytesMustAgreeWithTheDeclaredType(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	if resp := c.upload("image/png", []byte("this is not a png")); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %s, want 400", resp.Status)
	}
}

// The same screenshot pasted into three tasks is one row.
func TestTheSameImageTwiceIsOneAsset(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	body := onePixel(t, 40)

	first := c.json(c.upload("image/png", body))["id"]
	second := c.json(c.upload("image/png", body))["id"]
	if first != second {
		t.Errorf("the same bytes produced %v and %v", first, second)
	}
}

// One call, on create and on edit alike, and the response shows what was actually saved.
func TestAnInlineImageBecomesAnAsset(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	encoded := base64.StdEncoding.EncodeToString(onePixel(t, 90))
	body, _ := json.Marshal(map[string]string{
		"title":       "Fix the tap",
		"description": "It drips.\n\n![](data:image/png;base64," + encoded + ")",
	})
	made := c.task(string(body))

	description := made["description"].(string)
	if strings.Contains(description, "data:image") {
		t.Fatal("a data: URI reached storage")
	}
	if !strings.Contains(description, "/api/assets/a_") {
		t.Fatalf("description = %q, want the asset URL", description)
	}

	// And it is really there.
	url := description[strings.Index(description, "/api/assets/"):]
	url = strings.TrimSuffix(url, ")")
	if resp := c.do("GET", url, ""); resp.StatusCode != http.StatusOK {
		t.Errorf("the rewritten URL serves %s", resp.Status)
	}
}

// The edit, which is where it hung: the image was stored from inside the task's own transaction,
// on a writer pool of one connection, so it waited on itself and every write queued behind it.
// Bounded, so a regression fails here rather than hanging the suite.
func TestAnInlineImageInAnEditDoesNotHang(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)
	id := c.task(`{"title":"Fix the tap"}`)["id"].(string)

	encoded := base64.StdEncoding.EncodeToString(onePixel(t, 90))
	body, _ := json.Marshal(map[string]string{
		"description": "It drips.\n\n![](data:image/png;base64," + encoded + ")",
	})
	// A deadline on the request, as a client that gives up is: the server's wait is cancelled
	// with it, so a regression answers here as a failure instead of hanging the suite behind a
	// writer that never comes back.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	r := httptest.NewRequest("PATCH", "/api/tasks/"+id, strings.NewReader(string(body))).WithContext(ctx)
	r.Header.Set("Content-Type", "application/json")
	r.AddCookie(c.cookie)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if ctx.Err() != nil {
		t.Fatal("a PATCH with an inline image did not answer in five seconds")
	}
	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch = %s", resp.Status)
	}
	description := c.json(resp)["description"].(string)
	if strings.Contains(description, "data:image") || !strings.Contains(description, "/api/assets/a_") {
		t.Errorf("description = %q, want the asset URL in place of the data: URI", description)
	}

	// And the writer is free: the next write goes through.
	c.task(`{"title":"Another"}`)
}

// If one image is refused, none of them is stored and the task is left as it was.
func TestTooManyInlineImagesStoresNone(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	var sb strings.Builder
	sb.WriteString("Lots.\n")
	for i := 0; i < 25; i++ {
		encoded := base64.StdEncoding.EncodeToString(onePixel(t, uint8(i*7)))
		fmt.Fprintf(&sb, "![](data:image/png;base64,%s)\n", encoded)
	}
	body, _ := json.Marshal(map[string]string{"title": "Too many", "description": sb.String()})

	resp := c.do("POST", "/api/tasks", string(body))
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %s, want 413", resp.Status)
	}
	if code := c.json(resp)["code"]; code != CodeAssetCountExceeded {
		t.Errorf("code = %v, want the one that says which limit", code)
	}
	if got := len(c.list("")["tasks"].([]any)); got != 0 {
		t.Error("a refused write left a task behind")
	}
}

// Pasting somebody else's asset URL must not grant you their image.
func TestAnAssetIsServedOnlyToItsOwner(t *testing.T) {
	s, st := newServerStore(t, nil)
	mine := signIn(t, s, st)
	url := mine.json(mine.upload("image/png", onePixel(t, 40)))["url"].(string)

	account(t, st, "other", "a good password")
	theirs := newClient(t, s)
	theirs.do("POST", "/api/auth/login", `{"username":"other","password":"a good password"}`)

	if resp := theirs.do("GET", url, ""); resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %s, want 404", resp.Status)
	}
}

// An asset nothing references is swept; one a description still names is not.
func TestOrphanedAssetsAreSweptAndReferencedOnesAreNot(t *testing.T) {
	s, st := newServerStore(t, nil)
	c := signIn(t, s, st)

	keptURL := c.json(c.upload("image/png", onePixel(t, 40)))["url"].(string)
	c.json(c.upload("image/png", onePixel(t, 200)))
	c.task(`{"title":"Has an image","description":"![](` + keptURL + `)"}`)

	// The grace period is on created_at, so a clock far enough forward is what exposes both.
	now := st.Now().Add(48 * time.Hour)
	st.SetClock(func() time.Time { return now })

	n, err := st.SweepOrphanAssets(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("swept %d assets, want the unreferenced one only", n)
	}
	if resp := c.do("GET", keptURL, ""); resp.StatusCode != http.StatusOK {
		t.Error("the referenced image was swept")
	}
}
