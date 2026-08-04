package main

import "time"

type v452ImportToastFrame struct {
	Alpha   byte
	OffsetY int32
	Done    bool
}

func v452ImportToastFrameAt(elapsed, duration time.Duration, closing bool) v452ImportToastFrame {
	if duration <= 0 {
		duration = time.Millisecond
	}
	progress := float64(elapsed) / float64(duration)
	if progress < 0 {
		progress = 0
	}
	if progress > 1 {
		progress = 1
	}
	if closing {
		return v452ImportToastFrame{
			Alpha:   byte(255 * (1 - progress)),
			OffsetY: -int32(8 * progress),
			Done:    progress >= 1,
		}
	}
	return v452ImportToastFrame{
		Alpha:   byte(255 * progress),
		OffsetY: int32(16 * (1 - progress)),
		Done:    progress >= 1,
	}
}
