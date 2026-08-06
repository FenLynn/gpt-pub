//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"mediaworkbench/internal/model"
)

const round11ScrollPreviewArg = "--round11-scroll-preview"

func round11ScrollPreviewRequested(args []string) bool {
	for _, raw := range args {
		if strings.EqualFold(strings.TrimSpace(raw), round11ScrollPreviewArg) {
			return true
		}
	}
	return false
}

func round11ClonePreviewTask(a *application, source *model.Task, index int) *model.Task {
	if a == nil || source == nil {
		return nil
	}
	clone := *source
	clone.ID = a.nextID.Add(1)
	clone.Root = `C:\Mediova滚动验证`
	clone.Input = filepath.Join(
		clone.Root,
		fmt.Sprintf("批次%02d", index/7+1),
		fmt.Sprintf("滚动稳定性验证任务_%02d_%s", index+1, filepath.Base(source.Input)),
	)
	clone.ThumbnailIndex = -1
	if source.Queue != nil {
		queue := *source.Queue
		queue.Sequence = int64(index + 1)
		clone.Queue = &queue
	}
	if source.Hold != nil {
		hold := *source.Hold
		if source.Hold.Queue != nil {
			queue := *source.Hold.Queue
			queue.Sequence = int64(index + 1)
			hold.Queue = &queue
		}
		clone.Hold = &hold
	}
	return &clone
}

func round11PopulateScrollPreview(a *application) {
	if a == nil || !a.uiPreview || a.hList == 0 {
		return
	}
	a.mu.Lock()
	seed := append([]*model.Task(nil), a.tasks...)
	if len(seed) == 0 {
		a.mu.Unlock()
		return
	}
	expanded := make([]*model.Task, 0, 35)
	for index := 0; index < 35; index++ {
		if task := round11ClonePreviewTask(a, seed[index%len(seed)], index); task != nil {
			expanded = append(expanded, task)
		}
	}
	a.tasks = expanded
	a.pendingSelection = make(map[int64]bool)
	a.mu.Unlock()

	a.refreshList()
	a.refreshTotal()
	a.updateRightPanel()
	round11PositionStableScrollSurfaces(a)
}

func init() {
	if !round11ScrollPreviewRequested(os.Args[1:]) {
		return
	}
	go func() {
		deadline := time.Now().Add(20 * time.Second)
		for time.Now().Before(deadline) {
			a := app
			if a != nil && a.hwnd != 0 && a.hList != 0 && a.controlsReady && a.uiPreview {
				a.postUI(func() {
					round11PopulateScrollPreview(a)
				})
				return
			}
			time.Sleep(50 * time.Millisecond)
		}
	}()
}
