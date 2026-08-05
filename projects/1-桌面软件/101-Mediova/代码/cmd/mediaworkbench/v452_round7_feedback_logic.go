package main

import "mediaworkbench/internal/model"

type round7FeedbackColumnProfiles struct {
	Version int   `json:"version"`
	Video   []int `json:"video"`
	Image   []int `json:"image"`
}

func round7FeedbackCloneWidths(widths []int) []int {
	if len(widths) == 0 {
		return nil
	}
	return append([]int(nil), widths...)
}

func round7FeedbackEqualWidths(left, right []int) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func (p round7FeedbackColumnProfiles) For(kind model.Kind) []int {
	if kind == model.KindImage {
		return round7FeedbackCloneWidths(p.Image)
	}
	return round7FeedbackCloneWidths(p.Video)
}

func (p *round7FeedbackColumnProfiles) Set(kind model.Kind, widths []int) {
	if p == nil {
		return
	}
	p.Version = 2
	if kind == model.KindImage {
		p.Image = round7FeedbackCloneWidths(widths)
		return
	}
	p.Video = round7FeedbackCloneWidths(widths)
}

func round7FeedbackHoverIntent(width, height, x, y, edge int, needH, needV bool) (showH, showV bool) {
	if width <= 0 || height <= 0 || edge <= 0 {
		return false, false
	}
	if x < 0 || y < 0 || x >= width || y >= height {
		return false, false
	}
	showV = needV && x >= width-edge
	showH = needH && y >= height-edge
	return showH, showV
}

func round7FeedbackThumbGeometry(trackStart, trackLength, minimum, maximum, page, position int) (start, length int) {
	if trackLength <= 0 {
		return trackStart, 0
	}
	rangeLength := maximum - minimum + 1
	if rangeLength <= 0 || page >= rangeLength {
		return trackStart, trackLength
	}
	length = trackLength * page / rangeLength
	if length < 24 {
		length = 24
	}
	if length > trackLength {
		length = trackLength
	}
	maxPosition := maximum - page + 1
	if maxPosition < minimum {
		maxPosition = minimum
	}
	if position < minimum {
		position = minimum
	}
	if position > maxPosition {
		position = maxPosition
	}
	movable := trackLength - length
	if movable <= 0 || maxPosition == minimum {
		return trackStart, length
	}
	start = trackStart + (position-minimum)*movable/(maxPosition-minimum)
	return start, length
}

func round7FeedbackTaskEditable(status model.Status) bool {
	switch status {
	case model.StatusQueued, model.StatusProcessing, model.StatusPaused:
		return false
	default:
		return true
	}
}
