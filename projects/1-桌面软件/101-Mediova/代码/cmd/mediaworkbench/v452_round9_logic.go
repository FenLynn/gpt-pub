package main

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
