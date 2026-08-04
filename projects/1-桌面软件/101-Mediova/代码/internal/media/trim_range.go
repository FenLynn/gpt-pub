package media

import "math"

// TrimRangeState is the complete logical state rendered by the v4.5.2 trim
// timeline. Start and End define the selected output interval; Playhead is an
// independent preview position and must never be moved as a side effect of
// changing the output interval.
type TrimRangeState struct {
	Start    float64
	End      float64
	Playhead float64
}

type TrimTimelineHit int

const (
	TrimTimelineNone TrimTimelineHit = iota
	TrimTimelineStart
	TrimTimelineEnd
	TrimTimelinePlayhead
	// TrimTimelineRange is kept for source compatibility with the fourth- and
	// fifth-round probes. The real UI no longer drags the whole interval: a
	// click between or outside the handles seeks the independent playhead.
	TrimTimelineRange
)

func clampFloat(value, minimum, maximum float64) float64 {
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}

func MinimumTrimSpan(duration, fps float64) float64 {
	if duration <= 0 {
		return 0
	}
	span := 0.04
	if fps > 0.1 {
		span = 1 / fps
	}
	if span < 0.001 {
		span = 0.001
	}
	if span > duration {
		span = duration
	}
	return span
}

func NormalizeTrimRange(duration, fps float64, state TrimRangeState) TrimRangeState {
	if duration <= 0 || math.IsNaN(duration) || math.IsInf(duration, 0) {
		return TrimRangeState{}
	}
	if state.End <= 0 || math.IsNaN(state.End) || math.IsInf(state.End, 0) {
		state.End = duration
	}
	state.Start = clampFloat(state.Start, 0, duration)
	state.End = clampFloat(state.End, 0, duration)
	minimum := MinimumTrimSpan(duration, fps)
	if state.End-state.Start < minimum {
		if state.Start+minimum <= duration {
			state.End = state.Start + minimum
		} else {
			state.End = duration
			state.Start = math.Max(0, duration-minimum)
		}
	}
	// The preview cursor is intentionally normalized only to the source media
	// duration. It may sit outside the retained interval while the user inspects
	// frames before choosing a new start or end point.
	state.Playhead = clampFloat(state.Playhead, 0, duration)
	return state
}

func TimelineTimeToX(value, duration float64, left, right int) int {
	if right <= left || duration <= 0 {
		return left
	}
	value = clampFloat(value, 0, duration)
	return left + int(math.Round(value/duration*float64(right-left)))
}

func TimelineXToTime(x, duration float64, left, right int) float64 {
	if right <= left || duration <= 0 {
		return 0
	}
	x = clampFloat(x, float64(left), float64(right))
	return (x - float64(left)) / float64(right-left) * duration
}

func HitTrimTimeline(state TrimRangeState, duration float64, x, left, right, threshold int) TrimTimelineHit {
	if duration <= 0 || right <= left || x < left || x > right {
		return TrimTimelineNone
	}
	if threshold < 1 {
		threshold = 1
	}
	startX := TimelineTimeToX(state.Start, duration, left, right)
	endX := TimelineTimeToX(state.End, duration, left, right)
	playX := TimelineTimeToX(state.Playhead, duration, left, right)

	startDistance := absInt(x - startX)
	endDistance := absInt(x - endX)
	if startDistance <= threshold || endDistance <= threshold {
		if startDistance <= endDistance {
			return TrimTimelineStart
		}
		return TrimTimelineEnd
	}
	if absInt(x-playX) <= threshold {
		return TrimTimelinePlayhead
	}
	// The specification defines three draggable objects only: start, end and
	// playhead. Clicking anywhere else on the track is a seek operation.
	return TrimTimelinePlayhead
}

func DragTrimTimeline(initial TrimRangeState, duration, fps float64, hit TrimTimelineHit, anchorTime, targetTime float64) TrimRangeState {
	state := NormalizeTrimRange(duration, fps, initial)
	minimum := MinimumTrimSpan(duration, fps)
	targetTime = clampFloat(targetTime, 0, duration)
	switch hit {
	case TrimTimelineStart:
		state.Start = math.Min(targetTime, state.End-minimum)
	case TrimTimelineEnd:
		state.End = math.Max(targetTime, state.Start+minimum)
	case TrimTimelinePlayhead, TrimTimelineRange, TrimTimelineNone:
		// Range is deliberately treated as a seek for backward compatibility.
		// Start and End never move unless their own handles are dragged.
		state.Playhead = targetTime
	}
	return NormalizeTrimRange(duration, fps, state)
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}
