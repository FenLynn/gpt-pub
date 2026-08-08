package main

import (
	"fmt"
	"math"
	"time"

	"mediaworkbench/internal/model"
)

func round12ClockText(seconds float64) string {
	if seconds < 0 || math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		seconds = 0
	}
	d := time.Duration(math.Floor(seconds)) * time.Second
	h := int(d / time.Hour)
	m := int((d % time.Hour) / time.Minute)
	s := int((d % time.Minute) / time.Second)
	return fmt.Sprintf("%02d:%02d:%02d", h, m, s)
}

func round12TimeCropLines(t *model.Task, opts model.TaskOptions) (top, bottom string, active bool) {
	if t == nil {
		return "无", "", false
	}
	start := opts.TrimStart
	end := opts.TrimEnd
	endIsLimited := end > 0 && (t.Duration <= 0 || end < t.Duration-0.001)
	active = start > 0.001 || endIsLimited
	if !active {
		return "无", "", false
	}
	if end <= 0 {
		end = t.Duration
	}
	if end < start {
		end = start
	}
	return "起：" + round12ClockText(start), "止：" + round12ClockText(end), true
}

func round12PictureCropText(t *model.Task, opts model.TaskOptions) string {
	if t == nil || !opts.Crop.Enabled || opts.Crop.Width <= 0 || opts.Crop.Height <= 0 || t.Width <= 0 || t.Height <= 0 {
		return "100%"
	}
	total := float64(t.Width) * float64(t.Height)
	area := float64(opts.Crop.Width) * float64(opts.Crop.Height)
	if total <= 0 || area <= 0 {
		return "100%"
	}
	percent := area / total * 100
	if percent > 100 {
		percent = 100
	}
	if percent < 0.1 {
		percent = 0.1
	}
	if math.Abs(percent-math.Round(percent)) < 0.05 {
		return fmt.Sprintf("%.0f%%", percent)
	}
	return fmt.Sprintf("%.1f%%", percent)
}

func round12ThumbnailIndexValid(index int) bool {
	return index >= 0
}
