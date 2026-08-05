//go:build windows

package main

import (
	"os"
	"strings"
	"sync/atomic"
	"time"

	"mediaworkbench/internal/model"
)

var (
	round11EditorPreviewEnabled = round11HasArgument("--round11-editor-preview")
	round11EditorPreviewStarted atomic.Bool
)

func init() {
	if !round11EditorPreviewEnabled {
		return
	}
	go func() {
		for attempt := 0; attempt < 600; attempt++ {
			a := app
			if a != nil && a.hwnd != 0 && a.controlsReady && round11EditorPreviewStarted.CompareAndSwap(false, true) {
				a.postUI(func() { round11OpenEditorPreview(a) })
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
	}()
}

func round11HasArgument(target string) bool {
	for _, argument := range os.Args[1:] {
		if strings.EqualFold(strings.TrimSpace(argument), target) {
			return true
		}
	}
	return false
}

func round11OpenEditorPreview(a *application) {
	if a == nil {
		return
	}
	task := &model.Task{
		ID:             a.nextID.Add(1),
		Input:          "Round11-Flicker-Probe.mp4",
		Root:           ".",
		Kind:           model.KindVideo,
		Width:          1280,
		Height:         720,
		Duration:       12,
		FPS:            30,
		Status:         model.StatusReady,
		ThumbnailIndex: -1,
	}
	opts := a.settings.DefaultOptions(model.KindVideo)
	opts.FollowDefaults = false
	opts.TrimStart = 2
	opts.TrimEnd = 10
	opts.Crop = model.Crop{Enabled: true, X: 160, Y: 90, Width: 640, Height: 360}
	round7ShowEditor(a, task, opts, []int{0})
}
