package main

import "time"

// activeRunClock tracks only the intervals during which the queue is actually
// running. Paused wall-clock time is excluded from elapsed and remaining-time
// estimates, so UI refresh frequency cannot change the accounting result.
type activeRunClock struct {
	startedAt   time.Time
	pausedAt    time.Time
	pausedTotal time.Duration
	paused      bool
}

func (c *activeRunClock) Reset(start time.Time) {
	*c = activeRunClock{startedAt: start}
}

func (c *activeRunClock) SetPaused(paused bool, now time.Time) {
	if c == nil || c.startedAt.IsZero() || paused == c.paused {
		return
	}
	if now.Before(c.startedAt) {
		now = c.startedAt
	}
	if paused {
		c.paused = true
		c.pausedAt = now
		return
	}
	if !c.pausedAt.IsZero() && now.After(c.pausedAt) {
		c.pausedTotal += now.Sub(c.pausedAt)
	}
	c.paused = false
	c.pausedAt = time.Time{}
}

func (c activeRunClock) Elapsed(now time.Time) time.Duration {
	if c.startedAt.IsZero() {
		return 0
	}
	if now.Before(c.startedAt) {
		now = c.startedAt
	}
	end := now
	if c.paused && !c.pausedAt.IsZero() {
		end = c.pausedAt
	}
	elapsed := end.Sub(c.startedAt) - c.pausedTotal
	if elapsed < 0 {
		return 0
	}
	return elapsed
}

func (c activeRunClock) Paused() bool { return c.paused }

func v452ShouldInvalidateProgress(oldPct, newPct float64, oldText, newText string, oldPaused, newPaused bool) bool {
	if oldText != newText || oldPaused != newPaused {
		return true
	}
	delta := newPct - oldPct
	if delta < 0 {
		delta = -delta
	}
	return delta >= 0.05
}

func v452StatusLampDiameter(rowHeight, textHeight int32) int32 {
	if rowHeight <= 0 {
		return 0
	}
	if textHeight <= 0 {
		textHeight = rowHeight - 4
	}
	if textHeight > rowHeight-2 {
		textHeight = rowHeight - 2
	}
	if textHeight < 4 {
		textHeight = 4
	}
	return textHeight
}
