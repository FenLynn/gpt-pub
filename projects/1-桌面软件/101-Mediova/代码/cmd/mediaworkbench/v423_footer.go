package main

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
		margin    int32 = 8
		gap       int32 = 8
		statusGap int32 = 12
		buttonH   int32 = 36
		startW    int32 = 132
		pauseW    int32 = 96
		stopW     int32 = 88
	)
	actionY := progressY + 32
	stopX := clientW - margin - stopW
	pauseX := stopX - gap - pauseW
	startX := pauseX - gap - startW
	statusW := startX - statusGap - margin
	if statusW < 120 {
		statusW = 120
	}
	return footerGeometry{
		Progress: footerRect{X: margin, Y: progressY, W: clientW - 2*margin, H: 24},
		Status:   footerRect{X: margin, Y: actionY, W: statusW, H: buttonH},
		Start:    footerRect{X: startX, Y: actionY, W: startW, H: buttonH},
		Pause:    footerRect{X: pauseX, Y: actionY, W: pauseW, H: buttonH},
		Stop:     footerRect{X: stopX, Y: actionY, W: stopW, H: buttonH},
	}
}

func footerRectsOverlap(a, b footerRect) bool {
	return a.X < b.X+b.W && a.X+a.W > b.X && a.Y < b.Y+b.H && a.Y+a.H > b.Y
}
