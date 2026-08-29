//go:build windows

package main

import (
	"mediaworkbench/internal/model"
)

func performanceWorkerCap(mode string, kind model.Kind, workers int) int {
	if workers < 1 {
		return 1
	}
	switch model.NormalizePerformanceMode(mode) {
	case model.PerformanceModeLowMemory:
		if workers > 2 {
			return 2
		}
	case model.PerformanceModeLargeBatch:
		// Video and image queues still share every free machine slot. Only the
		// memory-heavy decoded still-image side is capped more conservatively.
		if kind == model.KindImage && workers > 4 {
			return 4
		}
	}
	return workers
}

func performanceThumbnailEagerLimit(mode string) int {
	switch model.NormalizePerformanceMode(mode) {
	case model.PerformanceModeLargeBatch:
		return 128
	case model.PerformanceModeLowMemory:
		return 48
	default:
		return 600
	}
}

// shouldQueueEagerThumbnail avoids filling the thumbnail queue with thousands
// of off-screen previews. The existing viewport recovery path generates the
// visible rows first as the user scrolls, so no feature is lost.
func (a *application) shouldQueueEagerThumbnail(kind model.Kind) bool {
	if a == nil {
		return false
	}
	limit := performanceThumbnailEagerLimit(a.settings.PerformanceMode)
	count := 0
	a.mu.Lock()
	for _, task := range a.tasks {
		if task != nil && task.Kind == kind {
			count++
			if count > limit {
				break
			}
		}
	}
	a.mu.Unlock()
	return count <= limit
}

func performanceModeSummary(mode string) string {
	switch model.NormalizePerformanceMode(mode) {
	case model.PerformanceModeLargeBatch:
		return "大批量：优先保持界面响应，仅按需生成屏幕外预览"
	case model.PerformanceModeLowMemory:
		return "低内存：最多同时处理 2 项，并显著减少后台预览"
	default:
		return "标准：完整预览与动态内存保护"
	}
}

func (a *application) applyPerformanceMode(mode string) {
	if a == nil {
		return
	}
	mode = model.NormalizePerformanceMode(mode)
	previous := model.NormalizePerformanceMode(a.settings.PerformanceMode)
	if mode == model.PerformanceModeLowMemory && previous != model.PerformanceModeLowMemory {
		a.settings.PerfOverrideSet = true
		a.settings.PerfPrevAuto = a.settings.AutoConcurrency
		a.settings.PerfPrevConcurrency = a.settings.Concurrency
		a.settings.AutoConcurrency = false
		a.settings.Concurrency = 2
	} else if previous == model.PerformanceModeLowMemory && mode != model.PerformanceModeLowMemory && a.settings.PerfOverrideSet {
		a.settings.AutoConcurrency = a.settings.PerfPrevAuto
		a.settings.Concurrency = a.settings.PerfPrevConcurrency
		a.settings.PerfOverrideSet = false
		a.settings.PerfPrevAuto = false
		a.settings.PerfPrevConcurrency = 0
	}
	a.settings.PerformanceMode = mode
}
