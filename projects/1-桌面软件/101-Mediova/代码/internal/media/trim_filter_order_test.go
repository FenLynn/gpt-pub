package media

import (
	"strings"
	"testing"

	"mediaworkbench/internal/model"
)

func TestBuildFiltersUsesPostRotationCropCoordinates(t *testing.T) {
	for _, rotation := range []string{"90°右转", "90°左转", "180°"} {
		req := ConvertRequest{
			Kind: model.KindVideo,
			Options: model.TaskOptions{
				Rotation:   rotation,
				Resolution: "720P",
				Crop:       model.Crop{Enabled: true, X: 10, Y: 20, Width: 640, Height: 360},
			},
		}
		filters := BuildFilters(req)
		cropAt := strings.Index(filters, "crop=640:360:10:20")
		scaleAt := strings.Index(filters, "scale=")
		if cropAt < 0 || scaleAt < 0 || cropAt >= scaleAt {
			t.Fatalf("rotation=%q filters=%q: crop must precede scale", rotation, filters)
		}
		rotationAt := 0
		if rotation == "180°" {
			rotationAt = strings.Index(filters, "hflip,vflip")
		} else {
			rotationAt = strings.Index(filters, "transpose=")
		}
		if rotationAt < 0 || rotationAt >= cropAt {
			t.Fatalf("rotation=%q filters=%q: rotation must precede crop", rotation, filters)
		}
	}
}

func TestBuildFiltersNoRotationStillCropsBeforeScale(t *testing.T) {
	req := ConvertRequest{
		Kind: model.KindImage,
		Options: model.TaskOptions{
			Rotation:  "不旋转",
			ImageSize: "最大边 1920px",
			Crop:      model.Crop{Enabled: true, X: 2, Y: 4, Width: 800, Height: 600},
		},
	}
	filters := BuildFilters(req)
	cropAt := strings.Index(filters, "crop=800:600:2:4")
	scaleAt := strings.Index(filters, "scale=")
	if cropAt != 0 || scaleAt <= cropAt {
		t.Fatalf("filters=%q", filters)
	}
}
