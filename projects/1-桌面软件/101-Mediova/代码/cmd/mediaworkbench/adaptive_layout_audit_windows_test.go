//go:build windows

package main

import (
	"testing"

	"mediaworkbench/internal/model"
)

func TestAdaptiveTopBandContinuousWidthBudget(t *testing.T) {
	for width := int32(900); width <= 1920; width++ {
		band := topBandForWidth(width)
		toolbarRight := toolbarRightEdge(band)
		toggleW := int32(22)
		if width < 1120 {
			toggleW = 20
		}
		toggleX := width - 8 - toggleW
		statusGridX := toggleX - 7 - band.statusGridW
		filterX := statusGridX - 8 - band.filterW
		searchLeft := toolbarRight + 8
		searchRight := filterX - 7
		if searchRight-searchLeft < 90 {
			t.Fatalf("width=%d leaves insufficient search space: left=%d right=%d", width, searchLeft, searchRight)
		}
		if toolbarRight >= searchLeft || searchRight >= filterX || filterX+band.filterW > statusGridX {
			t.Fatalf("width=%d top-band order invalid", width)
		}
	}
}

func TestAdaptiveRightPanelContinuousWidthBudget(t *testing.T) {
	for width := int32(900); width <= 1920; width++ {
		rightW := int32(264)
		if width < 1180 {
			rightW = 238
		}
		listW := width - rightW - 24
		if listW < 520 {
			listW = 520
		}
		rightX := int32(16) + listW
		if rightX < 0 || rightX+rightW > width-8 {
			t.Fatalf("width=%d right panel outside client: x=%d w=%d", width, rightX, rightW)
		}
	}
}

func TestAdaptiveBottomParameterContinuousWidthBudget(t *testing.T) {
	for width := int32(900); width <= 1920; width++ {
		for _, kind := range []model.Kind{model.KindVideo, model.KindImage} {
			widths := bottomParameterWidths(kind)
			if width < 1320 {
				x := int32(8)
				for _, fieldW := range []int32{widths.Resolution, widths.Codec, widths.Quality, widths.Volume, widths.Rotation} {
					x += 38 + fieldW + 6
				}
				remaining := width - x - 8
				if remaining < 124 {
					t.Fatalf("width=%d kind=%v compact parameter row remaining=%d", width, kind, remaining)
				}
				continue
			}
			fixedBottomW := int32(38) + widths.Resolution + 7 + 34 + widths.Codec + 7 + 34 + widths.Quality + 7 + 34 + widths.Volume + 7 + 34 + widths.Rotation + 8 + 124
			editW := width - 8 - 116 - 6 - 60 - 8 - fixedBottomW - 8
			if editW < 210 {
				t.Fatalf("width=%d kind=%v output edit width=%d", width, kind, editW)
			}
		}
	}
}
