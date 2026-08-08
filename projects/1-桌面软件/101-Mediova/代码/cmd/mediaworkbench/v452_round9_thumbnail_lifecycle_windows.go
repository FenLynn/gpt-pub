//go:build windows

package main

import (
	"os"
	"sync"
	"time"

	"mediaworkbench/internal/media"
)

type round9ThumbnailAttempt struct {
	Attempts int
	Last     time.Time
	Input    string
}

var (
	round9ThumbnailMu       sync.Mutex
	round9ThumbnailAttempts = make(map[int64]round9ThumbnailAttempt)
	round9ThumbnailLastScan time.Time
)

// round9EnsureVisibleThumbnails decouples thumbnails from probe completion.
// Restored sessions and already-probed tasks are re-enqueued when they become
// visible. Only the viewport plus a small look-ahead is considered, and each
// failed task receives at most three spaced attempts.
func round9EnsureVisibleThumbnails(a *application, hwnd uintptr) {
	if a == nil || hwnd == 0 {
		return
	}
	ffmpeg, _, _, _, _ := a.componentSnapshot()
	if ffmpeg == "" {
		return
	}
	now := time.Now()
	round9ThumbnailMu.Lock()
	if now.Sub(round9ThumbnailLastScan) < 800*time.Millisecond {
		round9ThumbnailMu.Unlock()
		return
	}
	round9ThumbnailLastScan = now
	round9ThumbnailMu.Unlock()

	top := int(send(hwnd, round7FeedbackLVMGetTopIndex, 0, 0))
	page := int(send(hwnd, round7FeedbackLVMCountPerPage, 0, 0))
	if page < 1 {
		page = 16
	}
	end := top + page + 8

	type job struct {
		id    int64
		input string
		probe media.ProbeInfo
	}
	jobs := make([]job, 0, page+8)
	a.mu.Lock()
	rows := a.visible
	if top < 0 {
		top = 0
	}
	if end > len(rows) {
		end = len(rows)
	}
	for row := top; row < end; row++ {
		idx := rows[row]
		if idx < 0 || idx >= len(a.tasks) || a.tasks[idx] == nil {
			continue
		}
		task := a.tasks[idx]
		if task.ThumbnailIndex >= 0 {
			round9ThumbnailMu.Lock()
			delete(round9ThumbnailAttempts, task.ID)
			round9ThumbnailMu.Unlock()
			continue
		}
		if task.Input == "" {
			continue
		}
		jobs = append(jobs, job{
			id:    task.ID,
			input: task.Input,
			probe: media.ProbeInfo{Width: task.Width, Height: task.Height, Rotation: task.Rotation, Duration: task.Duration, FPS: task.FPS},
		})
	}
	a.mu.Unlock()

	for _, candidate := range jobs {
		if _, err := os.Stat(candidate.input); err != nil {
			continue
		}
		round9ThumbnailMu.Lock()
		attempt := round9ThumbnailAttempts[candidate.id]
		if attempt.Input != candidate.input {
			attempt = round9ThumbnailAttempt{Input: candidate.input}
		}
		if attempt.Attempts >= 3 || (!attempt.Last.IsZero() && now.Sub(attempt.Last) < 6*time.Second) {
			round9ThumbnailMu.Unlock()
			continue
		}
		attempt.Attempts++
		attempt.Last = now
		round9ThumbnailAttempts[candidate.id] = attempt
		round9ThumbnailMu.Unlock()
		a.queueThumbnail(candidate.id, candidate.input, candidate.probe)
		// The normal path prefers the persistent thumbnail cache. Give it a short
		// head start, but if the task is still missing a preview use the direct
		// temporary-BMP path proven by the native media tests. Caching is an
		// optimization and must not leave a visible row permanently on a
		// placeholder when the cache path fails.
		round12ScheduleThumbnailFallback(a, candidate.id, candidate.input, candidate.probe)
	}
}
