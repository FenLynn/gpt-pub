package main

import "testing"

func TestRound9CropMoveAndResize(t *testing.T) {
	original := round9CropBox{X: 100, Y: 80, Width: 320, Height: 180}
	moved := round9MoveCropBox(original, 40, 30, 640, 360)
	if moved != (round9CropBox{X: 140, Y: 110, Width: 320, Height: 180}) {
		t.Fatalf("unexpected moved crop: %+v", moved)
	}
	clamped := round9MoveCropBox(original, 500, 500, 640, 360)
	if clamped.X != 320 || clamped.Y != 180 {
		t.Fatalf("move did not clamp inside frame: %+v", clamped)
	}
	resized := round9ResizeCropBox(original, round9CropResizeSE, 500, 300, 640, 360)
	if resized != (round9CropBox{X: 100, Y: 80, Width: 400, Height: 220}) {
		t.Fatalf("unexpected resized crop: %+v", resized)
	}
	normalized := round9NormalizeEvenCrop(round9CropBox{X: 11, Y: 9, Width: 101, Height: 57}, 640, 360)
	if normalized.X%2 != 0 || normalized.Y%2 != 0 || normalized.Width%2 != 0 || normalized.Height%2 != 0 {
		t.Fatalf("crop was not normalized to even coordinates and dimensions: %+v", normalized)
	}
}
