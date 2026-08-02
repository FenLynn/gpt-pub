package main

import "strings"

type compressionTone int

const (
	compressionNeutral compressionTone = iota
	compressionYellow
	compressionGreen
	compressionRed
)

type compressionVisual struct {
	InputFraction float64
	Tone          compressionTone
	Intensity     float64
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func compressionVisualFor(inputSize, outputSize int64) compressionVisual {
	if inputSize <= 0 || outputSize <= 0 {
		return compressionVisual{InputFraction: .5, Tone: compressionNeutral}
	}
	total := float64(inputSize + outputSize)
	ratio := float64(outputSize) / float64(inputSize)
	visual := compressionVisual{InputFraction: float64(inputSize) / total}

	// Yellow has the highest priority: near 1:1 results are informational rather
	// than warnings, and a small final file is acceptable even when it grew.
	if (ratio >= .90 && ratio <= 1.10) || (outputSize > inputSize && outputSize < 15*1024*1024) {
		visual.Tone = compressionYellow
		visual.Intensity = clamp01(absFloat(ratio-1) / .10)
		return visual
	}
	if ratio < .90 {
		visual.Tone = compressionGreen
		visual.Intensity = clamp01((.90 - ratio) / .75)
		return visual
	}
	visual.Tone = compressionRed
	visual.Intensity = clamp01((ratio - 1.10) / 1.50)
	return visual
}

func absFloat(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func normalizeDirectoryKey(path string) string {
	path = strings.TrimSpace(path)
	path = strings.TrimRight(path, "\\/")
	return strings.ToLower(path)
}

func rememberRecentDirectory(current string, previous []string, limit int) []string {
	current = strings.TrimSpace(current)
	if limit <= 0 {
		limit = 10
	}
	result := make([]string, 0, limit)
	seen := make(map[string]bool, limit)
	appendOne := func(path string) {
		path = strings.TrimSpace(path)
		key := normalizeDirectoryKey(path)
		if key == "" || seen[key] || len(result) >= limit {
			return
		}
		seen[key] = true
		result = append(result, path)
	}
	appendOne(current)
	for _, path := range previous {
		appendOne(path)
	}
	return result
}
