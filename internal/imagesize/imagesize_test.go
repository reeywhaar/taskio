package imagesize

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/jpeg"
	"image/png"
	"testing"
)

func pngOf(t *testing.T, w, h int, extra ...[]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	// After the signature and IHDR, before the pixels, where an encoder puts them.
	at := 8 + 8 + 13 + 4
	out := append([]byte{}, b[:at]...)
	for _, c := range extra {
		out = append(out, c...)
	}
	return append(out, b[at:]...)
}

func chunk(kind string, data []byte) []byte {
	out := binary.BigEndian.AppendUint32(nil, uint32(len(data)))
	out = append(out, kind...)
	out = append(out, data...)
	return binary.BigEndian.AppendUint32(out, crc32.ChecksumIEEE(append([]byte(kind), data...)))
}

func phys(perMetre uint32) []byte {
	d := binary.BigEndian.AppendUint32(nil, perMetre)
	d = binary.BigEndian.AppendUint32(d, perMetre)
	return chunk("pHYs", append(d, 1))
}

// exif is a little-endian TIFF block with XResolution and ResolutionUnit, as macOS writes.
func exif(dpi uint32) []byte {
	t := []byte("II*\x00")
	t = binary.LittleEndian.AppendUint32(t, 8)
	t = binary.LittleEndian.AppendUint16(t, 2)
	t = binary.LittleEndian.AppendUint16(t, 0x011a)
	t = binary.LittleEndian.AppendUint16(t, 5)
	t = binary.LittleEndian.AppendUint32(t, 1)
	t = binary.LittleEndian.AppendUint32(t, 8+2+24+4)
	t = binary.LittleEndian.AppendUint16(t, 0x0128)
	t = binary.LittleEndian.AppendUint16(t, 3)
	t = binary.LittleEndian.AppendUint32(t, 1)
	t = binary.LittleEndian.AppendUint32(t, 2)
	t = binary.LittleEndian.AppendUint32(t, 0)
	t = binary.LittleEndian.AppendUint32(t, dpi)
	return binary.LittleEndian.AppendUint32(t, 1)
}

func jpegOf(t *testing.T, w, h int, segments ...[]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, image.NewRGBA(image.Rect(0, 0, w, h)), nil); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	out := append([]byte{}, b[:2]...)
	for _, s := range segments {
		out = append(out, s...)
	}
	return append(out, b[2:]...)
}

func segment(marker byte, data []byte) []byte {
	out := []byte{0xff, marker}
	out = binary.BigEndian.AppendUint16(out, uint16(len(data)+2))
	return append(out, data...)
}

func jfif(unit byte, density uint16) []byte {
	d := append([]byte("JFIF\x00"), 1, 1, unit)
	d = binary.BigEndian.AppendUint16(d, density)
	d = binary.BigEndian.AppendUint16(d, density)
	return segment(0xe0, append(d, 0, 0))
}

func TestARetinaScreenshotIsDrawnAtHalfItsPixels(t *testing.T) {
	for name, body := range map[string][]byte{
		"png pHYs":  pngOf(t, 1062, 926, phys(5669)),
		"png eXIf":  pngOf(t, 1062, 926, chunk("eXIf", exif(144))),
		"jpeg JFIF": jpegOf(t, 1062, 926, jfif(1, 144)),
		"jpeg Exif": jpegOf(t, 1062, 926, segment(0xe1, append([]byte("Exif\x00\x00"), exif(144)...))),
	} {
		s, ok := Of(body)
		if !ok {
			t.Fatalf("%s: not read", name)
		}
		if w, h := s.Drawn(); s.Scale != 2 || w != 531 || h != 463 {
			t.Errorf("%s: scale %v, drawn %dx%d, want 2 and 531x463", name, s.Scale, w, h)
		}
	}
}

// 72 is a pixel for a pixel, and Windows writes 96 meaning the same.
func TestOrdinaryDensitiesAreDrawnAsTheyAre(t *testing.T) {
	for name, body := range map[string][]byte{
		"nothing said": pngOf(t, 400, 300),
		"72":           pngOf(t, 400, 300, phys(2835)),
		"96":           pngOf(t, 400, 300, phys(3780)),
		"jpeg 72":      jpegOf(t, 400, 300, jfif(1, 72)),
	} {
		s, ok := Of(body)
		if w, h := s.Drawn(); !ok || s.Scale != 1 || w != 400 || h != 300 {
			t.Errorf("%s: %+v, %v", name, s, ok)
		}
	}
	if s, _ := Of(pngOf(t, 900, 300, phys(8504))); s.Scale != 3 {
		t.Errorf("216 dpi is scale %v, want 3", s.Scale)
	}
}

func TestWhatIsNotAnImageIsNotRead(t *testing.T) {
	if _, ok := Of([]byte("%PDF-1.7")); ok {
		t.Error("a PDF read as an image")
	}
}
