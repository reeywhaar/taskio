// Package imagesize reads how big an image is meant to be drawn: its pixels, over the density
// its file says it was made at.
//
// A screenshot from a Retina screen has twice the pixels of what was on screen and says so —
// 144 dpi where 72 is a pixel for a pixel — and a browser draws an <img> a pixel for a pixel
// whatever the file says. Read once, when the file arrives, so a page can be told the size
// rather than finding it out.
package imagesize

import (
	"bytes"
	"encoding/binary"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"math"
)

// Size is an image's pixels and how many of them make a point.
type Size struct {
	Width, Height int
	// Scale is 2 for 144 dpi, 3 for 216, and 1 for anything under one and a half times 72 or
	// nothing said — 72 and Windows' 96 both mean "as it is".
	Scale float64
}

// Drawn is the size it is meant to be shown at, in CSS pixels.
func (s Size) Drawn() (width, height int) {
	return int(math.Round(float64(s.Width) / s.Scale)), int(math.Round(float64(s.Height) / s.Scale))
}

// Of reads an image's size, and false for what it cannot read: not an image, or a format whose
// header it does not know.
func Of(body []byte) (Size, bool) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(body))
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 {
		return Size{}, false
	}
	return Size{Width: cfg.Width, Height: cfg.Height, Scale: scaleOf(density(body))}, true
}

func scaleOf(dpi float64) float64 {
	if dpi < 108 {
		return 1
	}
	return math.Round(dpi/72*2) / 2
}

// density is the dots per inch a file says it was made at, or 0.
func density(b []byte) float64 {
	switch {
	case bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")):
		return pngDensity(b)
	case bytes.HasPrefix(b, []byte{0xff, 0xd8}):
		return jpegDensity(b)
	}
	return 0
}

// pngDensity reads pHYs, or failing that the EXIF in eXIf; both come before the pixels.
func pngDensity(b []byte) float64 {
	var exif []byte
	for at := 8; at+8 <= len(b); {
		n := int(binary.BigEndian.Uint32(b[at:]))
		kind := string(b[at+4 : at+8])
		end := at + 8 + n
		if kind == "IDAT" || end > len(b) {
			break
		}
		data := b[at+8 : end]
		switch kind {
		case "pHYs":
			if len(data) >= 9 && data[8] == 1 {
				return float64(binary.BigEndian.Uint32(data)) * 0.0254
			}
		case "eXIf":
			exif = data
		}
		at = end + 4
	}
	return exifDensity(exif)
}

// jpegDensity reads JFIF, or failing that EXIF; both are segments before the scan.
func jpegDensity(b []byte) float64 {
	var exif []byte
	for at := 2; at+4 <= len(b) && b[at] == 0xff; {
		marker := b[at+1]
		if marker == 0xda {
			break
		}
		end := at + 2 + int(binary.BigEndian.Uint16(b[at+2:]))
		if end > len(b) {
			break
		}
		data := b[at+4 : end]
		switch {
		case marker == 0xe0 && bytes.HasPrefix(data, []byte("JFIF\x00")) && len(data) >= 12:
			x := float64(binary.BigEndian.Uint16(data[8:]))
			switch data[7] {
			case 1:
				return x
			case 2:
				return x * 2.54
			}
		case marker == 0xe1 && bytes.HasPrefix(data, []byte("Exif\x00\x00")):
			exif = data[6:]
		}
		at = end
	}
	return exifDensity(exif)
}

// exifDensity reads XResolution and ResolutionUnit from the first IFD of a TIFF-shaped block.
func exifDensity(t []byte) float64 {
	if len(t) < 8 {
		return 0
	}
	var order binary.ByteOrder
	switch string(t[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 0
	}
	ifd := int(order.Uint32(t[4:]))
	if ifd+2 > len(t) {
		return 0
	}
	var x float64
	unit := uint16(2) // inches, when it does not say
	count := int(order.Uint16(t[ifd:]))
	for i := 0; i < count; i++ {
		e := ifd + 2 + 12*i
		if e+12 > len(t) {
			break
		}
		switch order.Uint16(t[e:]) {
		case 0x011a: // XResolution, a rational held elsewhere
			off := int(order.Uint32(t[e+8:]))
			if off+8 <= len(t) {
				if den := order.Uint32(t[off+4:]); den != 0 {
					x = float64(order.Uint32(t[off:])) / float64(den)
				}
			}
		case 0x0128: // ResolutionUnit
			unit = order.Uint16(t[e+8:])
		}
	}
	if unit == 3 {
		return x * 2.54
	}
	return x
}
