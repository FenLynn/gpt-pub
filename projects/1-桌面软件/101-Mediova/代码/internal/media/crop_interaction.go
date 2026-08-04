package media

import (
	"math"

	"mediaworkbench/internal/model"
)

type CropHandle int

const (
	CropHandleNone CropHandle = iota
	CropHandleCreate
	CropHandleMove
	CropHandleNorth
	CropHandleNorthEast
	CropHandleEast
	CropHandleSouthEast
	CropHandleSouth
	CropHandleSouthWest
	CropHandleWest
	CropHandleNorthWest
)

func HitCropHandle(crop model.Crop, x, y, tolerance int) CropHandle {
	if !crop.Enabled || crop.Width < 2 || crop.Height < 2 {
		return CropHandleNone
	}
	if tolerance < 1 {
		tolerance = 1
	}
	x1, y1 := crop.X, crop.Y
	x2, y2 := crop.X+crop.Width, crop.Y+crop.Height
	nearLeft := absInt(x-x1) <= tolerance
	nearRight := absInt(x-x2) <= tolerance
	nearTop := absInt(y-y1) <= tolerance
	nearBottom := absInt(y-y2) <= tolerance
	withinX := x >= x1-tolerance && x <= x2+tolerance
	withinY := y >= y1-tolerance && y <= y2+tolerance

	switch {
	case nearLeft && nearTop:
		return CropHandleNorthWest
	case nearRight && nearTop:
		return CropHandleNorthEast
	case nearRight && nearBottom:
		return CropHandleSouthEast
	case nearLeft && nearBottom:
		return CropHandleSouthWest
	case nearTop && withinX:
		return CropHandleNorth
	case nearRight && withinY:
		return CropHandleEast
	case nearBottom && withinX:
		return CropHandleSouth
	case nearLeft && withinY:
		return CropHandleWest
	case x > x1 && x < x2 && y > y1 && y < y2:
		return CropHandleMove
	default:
		return CropHandleNone
	}
}

func MoveCrop(frameW, frameH int, crop model.Crop, dx, dy int) model.Crop {
	enabled := crop.Enabled
	crop = ClampCrop(frameW, frameH, crop)
	crop.Enabled = enabled || crop.Width > 0
	maximumX := frameW - crop.Width
	maximumY := frameH - crop.Height
	crop.X = evenCropValue(clampInt(crop.X+dx, 0, maximumX))
	crop.Y = evenCropValue(clampInt(crop.Y+dy, 0, maximumY))
	return crop
}

func ResizeCrop(frameW, frameH int, crop model.Crop, handle CropHandle, dx, dy, ratioW, ratioH int, locked bool) model.Crop {
	crop = ClampCrop(frameW, frameH, crop)
	x1, y1 := crop.X, crop.Y
	x2, y2 := crop.X+crop.Width, crop.Y+crop.Height

	if handle == CropHandleMove {
		return MoveCrop(frameW, frameH, crop, dx, dy)
	}
	if locked && ratioW > 0 && ratioH > 0 {
		switch handle {
		case CropHandleNorthWest:
			return DragCropWithAspect(frameW, frameH, x2, y2, x1+dx, y1+dy, ratioW, ratioH, true)
		case CropHandleNorthEast:
			return DragCropWithAspect(frameW, frameH, x1, y2, x2+dx, y1+dy, ratioW, ratioH, true)
		case CropHandleSouthEast:
			return DragCropWithAspect(frameW, frameH, x1, y1, x2+dx, y2+dy, ratioW, ratioH, true)
		case CropHandleSouthWest:
			return DragCropWithAspect(frameW, frameH, x2, y1, x1+dx, y2+dy, ratioW, ratioH, true)
		case CropHandleEast, CropHandleWest:
			width := crop.Width
			if handle == CropHandleEast {
				width += dx
			} else {
				width -= dx
			}
			width = evenCropSize(width)
			height := evenCropSize(int(math.Round(float64(width) * float64(ratioH) / float64(ratioW))))
			centerY := crop.Y + crop.Height/2
			x := crop.X
			if handle == CropHandleWest {
				x = x2 - width
			}
			return ClampCrop(frameW, frameH, model.Crop{Enabled: true, X: x, Y: centerY - height/2, Width: width, Height: height})
		case CropHandleNorth, CropHandleSouth:
			height := crop.Height
			if handle == CropHandleSouth {
				height += dy
			} else {
				height -= dy
			}
			height = evenCropSize(height)
			width := evenCropSize(int(math.Round(float64(height) * float64(ratioW) / float64(ratioH))))
			centerX := crop.X + crop.Width/2
			y := crop.Y
			if handle == CropHandleNorth {
				y = y2 - height
			}
			return ClampCrop(frameW, frameH, model.Crop{Enabled: true, X: centerX - width/2, Y: y, Width: width, Height: height})
		}
	}

	switch handle {
	case CropHandleNorthWest:
		x1 = minInt(x1+dx, x2-2)
		y1 = minInt(y1+dy, y2-2)
	case CropHandleNorth:
		y1 = minInt(y1+dy, y2-2)
	case CropHandleNorthEast:
		x2 = maxInt(x2+dx, x1+2)
		y1 = minInt(y1+dy, y2-2)
	case CropHandleEast:
		x2 = maxInt(x2+dx, x1+2)
	case CropHandleSouthEast:
		x2 = maxInt(x2+dx, x1+2)
		y2 = maxInt(y2+dy, y1+2)
	case CropHandleSouth:
		y2 = maxInt(y2+dy, y1+2)
	case CropHandleSouthWest:
		x1 = minInt(x1+dx, x2-2)
		y2 = maxInt(y2+dy, y1+2)
	case CropHandleWest:
		x1 = minInt(x1+dx, x2-2)
	default:
		return crop
	}
	return ClampCrop(frameW, frameH, model.Crop{Enabled: true, X: x1, Y: y1, Width: x2 - x1, Height: y2 - y1})
}

func RotatedFrameSize(frameW, frameH, degrees int) (int, int) {
	degrees = normalizeRotation(degrees)
	if degrees == 90 || degrees == 270 {
		return frameH, frameW
	}
	return frameW, frameH
}

func RotateCropRect(frameW, frameH int, crop model.Crop, degrees int) model.Crop {
	enabled := crop.Enabled
	crop = ClampCrop(frameW, frameH, crop)
	degrees = normalizeRotation(degrees)
	var rotated model.Crop
	switch degrees {
	case 90:
		rotated = model.Crop{Enabled: enabled, X: frameH - (crop.Y + crop.Height), Y: crop.X, Width: crop.Height, Height: crop.Width}
	case 180:
		rotated = model.Crop{Enabled: enabled, X: frameW - (crop.X + crop.Width), Y: frameH - (crop.Y + crop.Height), Width: crop.Width, Height: crop.Height}
	case 270:
		rotated = model.Crop{Enabled: enabled, X: crop.Y, Y: frameW - (crop.X + crop.Width), Width: crop.Height, Height: crop.Width}
	default:
		rotated = crop
		rotated.Enabled = enabled
	}
	rotatedW, rotatedH := RotatedFrameSize(frameW, frameH, degrees)
	result := ClampCrop(rotatedW, rotatedH, rotated)
	result.Enabled = enabled
	return result
}

func UnrotateCropRect(frameW, frameH int, crop model.Crop, degrees int) model.Crop {
	degrees = normalizeRotation(degrees)
	rotatedW, rotatedH := RotatedFrameSize(frameW, frameH, degrees)
	return RotateCropRect(rotatedW, rotatedH, crop, 360-degrees)
}

func normalizeRotation(degrees int) int {
	degrees %= 360
	if degrees < 0 {
		degrees += 360
	}
	switch degrees {
	case 90, 180, 270:
		return degrees
	default:
		return 0
	}
}

func clampInt(value, minimum, maximum int) int {
	if maximum < minimum {
		maximum = minimum
	}
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
