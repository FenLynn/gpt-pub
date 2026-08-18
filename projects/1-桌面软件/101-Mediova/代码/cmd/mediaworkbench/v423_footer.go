package main

import (
	"fmt"
	"time"
)

// footerRect is expressed in unscaled logical pixels; move() applies the
// current DPI scale uniformly to every member of the footer.
type footerRect struct {
	X int32
	Y int32
	W int32
	H int32
}

type footerGeometry struct {
	Progress footerRect
	Status   footerRect
	Timing   footerRect
	Start    footerRect
	Pause    footerRect
	Stop     footerRect
}

func footerGeometryFor(clientW, barY int32, compact bool) footerGeometry {
	progressY := barY + 40
	if compact {
		progressY = barY + 76
	}
	const (
		margin       int32 = 12
		gap          int32 = 10
		statusGap    int32 = 14
		buttonH      int32 = 34
		wideStartW   int32 = 142
		widePauseW   int32 = 106
		wideStopW    int32 = 100
		compactStart int32 = 126
		compactOther int32 = 94
		minStatusW   int32 = 120
		messageMaxW  int32 = 760
	)
	startW, pauseW, stopW := wideStartW, widePauseW, wideStopW
	if clientW < 1040 {
		startW, pauseW, stopW = compactStart, compactOther, compactOther
	}
	actionY := progressY + 32
	stopX := clientW - margin - stopW
	pauseX := stopX - gap - pauseW
	startX := pauseX - gap - startW
	timingW := int32(280)
	if clientW < 1040 {
		timingW = 220
	}
	contentRight := startX - statusGap
	timingX := contentRight - timingW
	messageW := timingX - gap - margin
	if messageW > messageMaxW {
		messageW = messageMaxW
	}
	if messageW < minStatusW {
		messageW = minStatusW
		timingX = margin + messageW + gap
		startX = timingX + timingW + statusGap
		pauseX = startX + startW + gap
		stopX = pauseX + pauseW + gap
	}
	return footerGeometry{
		Progress: footerRect{X: margin, Y: progressY, W: clientW - 2*margin, H: 24},
		Status:   footerRect{X: margin, Y: actionY, W: messageW, H: buttonH},
		Timing:   footerRect{X: timingX, Y: actionY, W: timingW, H: buttonH},
		Start:    footerRect{X: startX, Y: actionY, W: startW, H: buttonH},
		Pause:    footerRect{X: pauseX, Y: actionY, W: pauseW, H: buttonH},
		Stop:     footerRect{X: stopX, Y: actionY, W: stopW, H: buttonH},
	}
}

func footerMinuteText(duration time.Duration, roundUp bool) string {
	if duration <= 0 {
		return "—"
	}
	if duration < time.Minute {
		return "<1m"
	}
	minutes := int64(duration / time.Minute)
	if roundUp && duration%time.Minute != 0 {
		minutes++
	}
	if minutes < 60 {
		return fmt.Sprintf("%dm", minutes)
	}
	return fmt.Sprintf("%dh %02dm", minutes/60, minutes%60)
}

func footerOverallLabel(completed, total int, pct float64) string {
	return fmt.Sprintf("已完成 %d/%d      %.1f%%", completed, total, pct)
}

func footerRectsOverlap(a, b footerRect) bool {
	return a.X < b.X+b.W && a.X+a.W > b.X && a.Y < b.Y+b.H && a.Y+a.H > b.Y
}
