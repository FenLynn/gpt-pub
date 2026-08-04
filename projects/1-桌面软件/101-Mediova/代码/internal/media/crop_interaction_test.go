package media

import (
	"testing"

	"mediaworkbench/internal/model"
)

func TestHitCropHandlePrioritizesCornersEdgesAndMove(t *testing.T) {
	crop := model.Crop{Enabled: true, X: 100, Y: 80, Width: 400, Height: 240}
	cases := []struct {
		x, y int
		want CropHandle
	}{
		{100, 80, CropHandleNorthWest},
		{500, 80, CropHandleNorthEast},
		{500, 320, CropHandleSouthEast},
		{100, 320, CropHandleSouthWest},
		{300, 80, CropHandleNorth},
		{500, 200, CropHandleEast},
		{300, 320, CropHandleSouth},
		{100, 200, CropHandleWest},
		{300, 200, CropHandleMove},
		{20, 20, CropHandleNone},
	}
	for _, tc := range cases {
		if got := HitCropHandle(crop, tc.x, tc.y, 8); got != tc.want {
			t.Fatalf("hit (%d,%d)=%v want=%v", tc.x, tc.y, got, tc.want)
		}
	}
}

func TestMoveCropPreservesSizeAndClamps(t *testing.T) {
	crop := model.Crop{Enabled: true, X: 100, Y: 80, Width: 400, Height: 240}
	moved := MoveCrop(640, 480, crop, 300, 300)
	if moved.X != 240 || moved.Y != 240 || moved.Width != 400 || moved.Height != 240 {
		t.Fatalf("bottom-right clamp=%+v", moved)
	}
	moved = MoveCrop(640, 480, crop, -1000, -1000)
	if moved.X != 0 || moved.Y != 0 || moved.Width != 400 || moved.Height != 240 {
		t.Fatalf("top-left clamp=%+v", moved)
	}
}

func TestResizeCropFreeAndLocked(t *testing.T) {
	initial := model.Crop{Enabled: true, X: 100, Y: 100, Width: 320, Height: 180}
	free := ResizeCrop(1280, 720, initial, CropHandleSouthEast, 100, 60, 0, 0, false)
	if free.X != 100 || free.Y != 100 || free.Width != 420 || free.Height != 240 {
		t.Fatalf("free resize=%+v", free)
	}

	locked := ResizeCrop(1280, 720, initial, CropHandleEast, 320, 0, 16, 9, true)
	if locked.Width != 640 || locked.Height != 360 || locked.X != 100 || locked.Y != 10 {
		t.Fatalf("locked edge resize=%+v", locked)
	}
	if locked.Width*9 != locked.Height*16 {
		t.Fatalf("locked ratio lost=%+v", locked)
	}

	corner := ResizeCrop(1280, 720, initial, CropHandleSouthEast, 320, 500, 16, 9, true)
	if corner.Width*9 != corner.Height*16 {
		t.Fatalf("locked corner ratio lost=%+v", corner)
	}
	if corner.X < 0 || corner.Y < 0 || corner.X+corner.Width > 1280 || corner.Y+corner.Height > 720 {
		t.Fatalf("locked corner out of frame=%+v", corner)
	}
}

func TestRotateCropRectExpectedCoordinates(t *testing.T) {
	crop := model.Crop{Enabled: true, X: 100, Y: 200, Width: 400, Height: 300}
	cases := []struct {
		degrees int
		want    model.Crop
	}{
		{0, model.Crop{Enabled: true, X: 100, Y: 200, Width: 400, Height: 300}},
		{90, model.Crop{Enabled: true, X: 580, Y: 100, Width: 300, Height: 400}},
		{180, model.Crop{Enabled: true, X: 1420, Y: 580, Width: 400, Height: 300}},
		{270, model.Crop{Enabled: true, X: 200, Y: 1420, Width: 300, Height: 400}},
	}
	for _, tc := range cases {
		if got := RotateCropRect(1920, 1080, crop, tc.degrees); got != tc.want {
			t.Fatalf("rotation %d=%+v want=%+v", tc.degrees, got, tc.want)
		}
	}
}

func TestRotateCropRectRoundTrip(t *testing.T) {
	original := model.Crop{Enabled: true, X: 122, Y: 84, Width: 640, Height: 358}
	for _, degrees := range []int{0, 90, 180, 270, 450, -90} {
		rotated := RotateCropRect(1920, 1080, original, degrees)
		got := UnrotateCropRect(1920, 1080, rotated, degrees)
		if got != original {
			t.Fatalf("round trip %d: rotated=%+v got=%+v want=%+v", degrees, rotated, got, original)
		}
	}
}
