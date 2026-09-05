//go:build windows

package media

import (
	"context"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

// This exercises the same WIC decode-to-PNG machinery used for HEIC without
// requiring a private photo fixture in the repository. HEIC availability is
// separately checked at runtime against the user's installed extension.
func TestWICDecodeToPNGRoundTrip(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "input.png")
	output := filepath.Join(dir, "output.png")
	f, err := os.Create(input)
	if err != nil {
		t.Fatal(err)
	}
	img := image.NewNRGBA(image.Rect(0, 0, 3, 2))
	img.SetNRGBA(2, 1, color.NRGBA{R: 23, G: 91, B: 177, A: 255})
	if err := png.Encode(f, img); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	info, err := DecodeModernImageToPNG(context.Background(), input, output)
	if err != nil {
		t.Fatalf("WIC PNG round trip: %v", err)
	}
	if info.Width != 3 || info.Height != 2 {
		t.Fatalf("unexpected WIC dimensions: %+v", info)
	}
	out, err := os.Open(output)
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()
	decoded, err := png.Decode(out)
	if err != nil {
		t.Fatal(err)
	}
	if got := color.NRGBAModel.Convert(decoded.At(2, 1)).(color.NRGBA); got.R != 23 || got.G != 91 || got.B != 177 || got.A != 255 {
		t.Fatalf("unexpected output pixel: %#v", got)
	}
}
