package media

import (
	"math"
	"strings"

	"mediaworkbench/internal/model"
)

func CropAspect(name string) (int, int, bool) {
	switch strings.TrimSpace(name) {
	case "16:9":
		return 16, 9, true
	case "9:16":
		return 9, 16, true
	case "1:1":
		return 1, 1, true
	case "4:3":
		return 4, 3, true
	default:
		return 0, 0, false
	}
}

func evenCropValue(v int) int {
	if v < 0 {
		return 0
	}
	return v &^ 1
}

func evenCropSize(v int) int {
	if v < 2 {
		return 2
	}
	return v &^ 1
}

func ClampCrop(frameW, frameH int, crop model.Crop) model.Crop {
	if frameW < 2 || frameH < 2 {
		return model.Crop{}
	}
	crop.X = evenCropValue(crop.X)
	crop.Y = evenCropValue(crop.Y)
	if crop.X > frameW-2 {
		crop.X = evenCropValue(frameW - 2)
	}
	if crop.Y > frameH-2 {
		crop.Y = evenCropValue(frameH - 2)
	}
	crop.Width = evenCropSize(crop.Width)
	crop.Height = evenCropSize(crop.Height)
	if crop.X+crop.Width > frameW {
		crop.Width = evenCropSize(frameW - crop.X)
	}
	if crop.Y+crop.Height > frameH {
		crop.Height = evenCropSize(frameH - crop.Y)
	}
	crop.Enabled = true
	return crop
}

func FitAspectCrop(frameW, frameH, ratioW, ratioH int) model.Crop {
	if frameW < 2 || frameH < 2 || ratioW <= 0 || ratioH <= 0 {
		return model.Crop{Enabled: false, Width: evenCropSize(frameW), Height: evenCropSize(frameH)}
	}
	w := frameW
	h := int(math.Round(float64(w) * float64(ratioH) / float64(ratioW)))
	if h > frameH {
		h = frameH
		w = int(math.Round(float64(h) * float64(ratioW) / float64(ratioH)))
	}
	w, h = evenCropSize(w), evenCropSize(h)
	x := evenCropValue((frameW - w) / 2)
	y := evenCropValue((frameH - h) / 2)
	return ClampCrop(frameW, frameH, model.Crop{Enabled: true, X: x, Y: y, Width: w, Height: h})
}

func DragCropWithAspect(frameW, frameH, ax, ay, bx, by, ratioW, ratioH int, locked bool) model.Crop {
	dx, dy := bx-ax, by-ay
	signX, signY := 1, 1
	if dx < 0 {
		signX, dx = -1, -dx
	}
	if dy < 0 {
		signY, dy = -1, -dy
	}
	if dx < 2 {
		dx = 2
	}
	if dy < 2 {
		dy = 2
	}
	if locked && ratioW > 0 && ratioH > 0 {
		fitH := int(math.Round(float64(dx) * float64(ratioH) / float64(ratioW)))
		if fitH <= dy {
			dy = fitH
		} else {
			dx = int(math.Round(float64(dy) * float64(ratioW) / float64(ratioH)))
		}
	}
	x, y := ax, ay
	if signX < 0 {
		x = ax - dx
	}
	if signY < 0 {
		y = ay - dy
	}
	return ClampCrop(frameW, frameH, model.Crop{Enabled: true, X: x, Y: y, Width: dx, Height: dy})
}
