package main

import "math"

type round7TimeModel struct {
	SourceStart float64
	TrimStart   float64
	Current     float64
	TrimEnd     float64
	SourceEnd   float64
}

func round7MinimumSpan(duration, fps float64) float64 {
	if fps <= 0.1 {
		fps = 25
	}
	span := 1 / fps
	if span < 0.001 {
		span = 0.001
	}
	if duration > 0 && span > duration {
		span = duration
	}
	return span
}

func round7NormalizeTimeModel(duration, fps, trimStart, current, trimEnd float64) round7TimeModel {
	if duration < 0 || math.IsNaN(duration) || math.IsInf(duration, 0) {
		duration = 0
	}
	minimum := round7MinimumSpan(duration, fps)
	clamp := func(value float64) float64 {
		if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
			return 0
		}
		if value > duration {
			return duration
		}
		return value
	}
	trimStart = clamp(trimStart)
	trimEnd = clamp(trimEnd)
	current = clamp(current)
	if duration <= 0 {
		return round7TimeModel{}
	}
	if trimEnd <= 0 {
		trimEnd = duration
	}
	if trimEnd-trimStart < minimum {
		if trimStart+minimum <= duration {
			trimEnd = trimStart + minimum
		} else {
			trimEnd = duration
			trimStart = math.Max(0, trimEnd-minimum)
		}
	}
	return round7TimeModel{
		SourceStart: 0,
		TrimStart:   trimStart,
		Current:     current,
		TrimEnd:     trimEnd,
		SourceEnd:   duration,
	}
}

func round7MoveCurrent(model round7TimeModel, value float64) round7TimeModel {
	return round7NormalizeTimeModel(model.SourceEnd, 25, model.TrimStart, value, model.TrimEnd)
}

func round7MoveTrimStart(model round7TimeModel, fps, value float64) round7TimeModel {
	minimum := round7MinimumSpan(model.SourceEnd, fps)
	if value < model.SourceStart {
		value = model.SourceStart
	}
	if value > model.TrimEnd-minimum {
		value = model.TrimEnd - minimum
	}
	if value < model.SourceStart {
		value = model.SourceStart
	}
	model.TrimStart = value
	return model
}

func round7MoveTrimEnd(model round7TimeModel, fps, value float64) round7TimeModel {
	minimum := round7MinimumSpan(model.SourceEnd, fps)
	if value > model.SourceEnd {
		value = model.SourceEnd
	}
	if value < model.TrimStart+minimum {
		value = model.TrimStart + minimum
	}
	if value > model.SourceEnd {
		value = model.SourceEnd
	}
	model.TrimEnd = value
	return model
}

func round7MarkerOrder(model round7TimeModel) [5]float64 {
	return [5]float64{model.SourceStart, model.TrimStart, model.Current, model.TrimEnd, model.SourceEnd}
}
