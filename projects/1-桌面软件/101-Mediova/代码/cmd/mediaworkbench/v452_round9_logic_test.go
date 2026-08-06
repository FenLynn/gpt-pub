package main

import "testing"

func TestRound9OverlayStateMachine(t *testing.T) {
	var m round9OverlayMachine
	if got := m.Move(round9AxisNone); got != round9OverlayNoop || m.Phase != round9OverlayHidden {
		t.Fatalf("central hover changed hidden state: action=%v phase=%v", got, m.Phase)
	}
	if got := m.Move(round9AxisVertical); got != round9OverlayArmShow || m.Phase != round9OverlayPending {
		t.Fatalf("edge did not arm show: action=%v phase=%v", got, m.Phase)
	}
	if m.ShowTimeout(round9AxisNone) {
		t.Fatal("show timeout accepted a cursor outside the edge")
	}
	if !m.ShowTimeout(round9AxisVertical) || m.Phase != round9OverlayVisible {
		t.Fatalf("show timeout did not make the thumb visible: phase=%v", m.Phase)
	}
	if got := m.Move(round9AxisNone); got != round9OverlayArmHide || m.Phase != round9OverlayVisible {
		t.Fatalf("leaving edge hid immediately: action=%v phase=%v", got, m.Phase)
	}
	if got := m.Move(round9AxisVertical); got != round9OverlayCancelHide || m.Phase != round9OverlayVisible {
		t.Fatalf("returning to edge did not keep the thumb stable: action=%v phase=%v", got, m.Phase)
	}
	if !m.BeginDrag(round9AxisVertical) || m.Phase != round9OverlayDragging {
		t.Fatalf("visible thumb did not enter dragging: phase=%v", m.Phase)
	}
	if got := m.Move(round9AxisNone); got != round9OverlayNoop || m.Phase != round9OverlayDragging {
		t.Fatalf("dragging thumb reacted to hover leave: action=%v phase=%v", got, m.Phase)
	}
	m.EndDrag(round9AxisVertical)
	if m.Phase != round9OverlayVisible {
		t.Fatalf("drag did not end visible: phase=%v", m.Phase)
	}
	m.Move(round9AxisNone)
	if !m.HideTimeout(round9AxisNone) || m.Phase != round9OverlayHidden {
		t.Fatalf("hide timeout did not hide after leaving edge: phase=%v", m.Phase)
	}
}

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
