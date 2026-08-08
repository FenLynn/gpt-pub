package main

const (
	round9AxisNone       uint8 = 0
	round9AxisHorizontal uint8 = 1
	round9AxisVertical   uint8 = 2
)

type round9OverlayPhase uint8

const (
	round9OverlayHidden round9OverlayPhase = iota
	round9OverlayPending
	round9OverlayVisible
	round9OverlayDragging
)

type round9OverlayMachine struct {
	Phase       round9OverlayPhase
	Axis        uint8
	PendingAxis uint8
}

type round9OverlayAction uint8

const (
	round9OverlayNoop round9OverlayAction = iota
	round9OverlayArmShow
	round9OverlayCancelShow
	round9OverlayArmHide
	round9OverlayCancelHide
	round9OverlayShow
	round9OverlayHide
)

func (m *round9OverlayMachine) Move(axis uint8) round9OverlayAction {
	switch m.Phase {
	case round9OverlayHidden:
		if axis == round9AxisNone {
			return round9OverlayNoop
		}
		m.Phase = round9OverlayPending
		m.PendingAxis = axis
		return round9OverlayArmShow
	case round9OverlayPending:
		if axis == round9AxisNone {
			m.Phase = round9OverlayHidden
			m.PendingAxis = round9AxisNone
			return round9OverlayCancelShow
		}
		if axis != m.PendingAxis {
			m.PendingAxis = axis
			return round9OverlayArmShow
		}
		return round9OverlayNoop
	case round9OverlayVisible:
		if axis == round9AxisNone {
			return round9OverlayArmHide
		}
		m.Axis = axis
		return round9OverlayCancelHide
	case round9OverlayDragging:
		return round9OverlayNoop
	default:
		return round9OverlayNoop
	}
}

func (m *round9OverlayMachine) ShowTimeout(axis uint8) bool {
	if m.Phase != round9OverlayPending || axis == round9AxisNone || axis != m.PendingAxis {
		return false
	}
	m.Phase = round9OverlayVisible
	m.Axis = axis
	m.PendingAxis = round9AxisNone
	return true
}

func (m *round9OverlayMachine) HideTimeout(axis uint8) bool {
	if m.Phase != round9OverlayVisible || axis != round9AxisNone {
		return false
	}
	m.Phase = round9OverlayHidden
	m.Axis = round9AxisNone
	return true
}

func (m *round9OverlayMachine) BeginDrag(axis uint8) bool {
	if m.Phase != round9OverlayVisible || axis == round9AxisNone || m.Axis&axis == 0 {
		return false
	}
	m.Phase = round9OverlayDragging
	m.Axis = axis
	return true
}

func (m *round9OverlayMachine) EndDrag(axis uint8) {
	m.Phase = round9OverlayVisible
	m.Axis = axis
}

type round9CropMode uint8

const (
	round9CropNone round9CropMode = iota
	round9CropCreate
	round9CropMove
	round9CropResizeN
	round9CropResizeS
	round9CropResizeW
	round9CropResizeE
	round9CropResizeNW
	round9CropResizeNE
	round9CropResizeSW
	round9CropResizeSE
)

type round9CropBox struct {
	X      int
	Y      int
	Width  int
	Height int
}

func round9ClampCropBox(box round9CropBox, frameW, frameH int) round9CropBox {
	if frameW < 2 {
		frameW = 2
	}
	if frameH < 2 {
		frameH = 2
	}
	if box.Width < 2 {
		box.Width = 2
	}
	if box.Height < 2 {
		box.Height = 2
	}
	if box.Width > frameW {
		box.Width = frameW
	}
	if box.Height > frameH {
		box.Height = frameH
	}
	if box.X < 0 {
		box.X = 0
	}
	if box.Y < 0 {
		box.Y = 0
	}
	if box.X+box.Width > frameW {
		box.X = frameW - box.Width
	}
	if box.Y+box.Height > frameH {
		box.Y = frameH - box.Height
	}
	return box
}

func round9MoveCropBox(original round9CropBox, dx, dy, frameW, frameH int) round9CropBox {
	original.X += dx
	original.Y += dy
	return round9ClampCropBox(original, frameW, frameH)
}

func round9ResizeCropBox(original round9CropBox, mode round9CropMode, x, y, frameW, frameH int) round9CropBox {
	left := original.X
	top := original.Y
	right := original.X + original.Width
	bottom := original.Y + original.Height

	switch mode {
	case round9CropResizeN, round9CropResizeNW, round9CropResizeNE:
		top = y
	case round9CropResizeS, round9CropResizeSW, round9CropResizeSE:
		bottom = y
	}
	switch mode {
	case round9CropResizeW, round9CropResizeNW, round9CropResizeSW:
		left = x
	case round9CropResizeE, round9CropResizeNE, round9CropResizeSE:
		right = x
	}

	if left > right-2 {
		left = right - 2
	}
	if top > bottom-2 {
		top = bottom - 2
	}
	if left < 0 {
		left = 0
	}
	if top < 0 {
		top = 0
	}
	if right > frameW {
		right = frameW
	}
	if bottom > frameH {
		bottom = frameH
	}
	return round9ClampCropBox(round9CropBox{X: left, Y: top, Width: right - left, Height: bottom - top}, frameW, frameH)
}

func round9NormalizeEvenCrop(box round9CropBox, frameW, frameH int) round9CropBox {
	box = round9ClampCropBox(box, frameW, frameH)
	box.X &^= 1
	box.Y &^= 1
	box.Width &^= 1
	box.Height &^= 1
	if box.Width < 2 {
		box.Width = 2
	}
	if box.Height < 2 {
		box.Height = 2
	}
	if box.X+box.Width > frameW {
		box.Width = (frameW - box.X) &^ 1
	}
	if box.Y+box.Height > frameH {
		box.Height = (frameH - box.Y) &^ 1
	}
	return round9ClampCropBox(box, frameW, frameH)
}
