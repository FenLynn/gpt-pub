package media

import "testing"

func TestFitAspectCrop(t *testing.T) {
	cases := []struct {
		w, h, rw, rh int
	}{
		{1920, 1080, 1, 1},
		{1080, 1920, 16, 9},
		{4000, 3000, 9, 16},
		{1920, 1080, 4, 3},
	}
	for _, tc := range cases {
		crop := FitAspectCrop(tc.w, tc.h, tc.rw, tc.rh)
		if !crop.Enabled || crop.X < 0 || crop.Y < 0 || crop.X+crop.Width > tc.w || crop.Y+crop.Height > tc.h {
			t.Fatalf("invalid fitted crop: %+v frame=%dx%d", crop, tc.w, tc.h)
		}
		got := float64(crop.Width) / float64(crop.Height)
		want := float64(tc.rw) / float64(tc.rh)
		if got < want-.01 || got > want+.01 {
			t.Fatalf("aspect mismatch got=%.4f want=%.4f crop=%+v", got, want, crop)
		}
	}
}

func TestDragCropWithAspectClampsAndLocks(t *testing.T) {
	crop := DragCropWithAspect(1920, 1080, 1700, 900, 400, 200, 16, 9, true)
	if crop.X < 0 || crop.Y < 0 || crop.X+crop.Width > 1920 || crop.Y+crop.Height > 1080 {
		t.Fatalf("crop escaped frame: %+v", crop)
	}
	ratio := float64(crop.Width) / float64(crop.Height)
	if ratio < 16.0/9-.02 || ratio > 16.0/9+.02 {
		t.Fatalf("ratio not locked: %.4f %+v", ratio, crop)
	}
}

func TestCropAspectNames(t *testing.T) {
	if w, h, ok := CropAspect("9:16"); !ok || w != 9 || h != 16 {
		t.Fatalf("unexpected aspect: %d:%d ok=%v", w, h, ok)
	}
	if _, _, ok := CropAspect("自由"); ok {
		t.Fatal("free aspect must not lock")
	}
}
