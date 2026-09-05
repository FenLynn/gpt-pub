//go:build windows

package main

import (
	"fmt"
	"strings"
)

func (a *application) mapFeaturesEnabled() bool { return a != nil && a.mapFeatureEnabled.Load() }

func (a *application) applyMapFeatureAvailability() {
	if a == nil {
		return
	}
	enabled := a.mapFeaturesEnabled()
	if !enabled {
		a.viewMode = mapViewList
		setText(a.hViewMode, mapViewLabel(mapViewList))
	}
	if a.hViewMode != 0 {
		enable(a.hViewMode, enabled)
		procInvalidateRect.Call(a.hViewMode, 0, 1)
	}
	if a.controlsReady {
		a.relayoutForMapMode()
	}
}

func (a *application) setMapFeaturesEnabled(enabled bool) {
	if a == nil || enabled == a.mapFeaturesEnabled() {
		return
	}
	a.mapFeatureEnabled.Store(enabled)
	a.settings.MapEnabled = enabled
	a.saveSettings()
	if !enabled {
		a.stopReverseGeocoding()
		a.shutdownReverseGeocoder()
		a.viewMode = mapViewList
		setText(a.hViewMode, mapViewLabel(mapViewList))
		a.applyMapFeatureAvailability()
		a.shutdownMapRuntime()
		a.syncMenuChecks()
		setText(a.hStatusText, "地图与位置功能已关闭；地图、定位解析和后台地名反查均已停止，现有 GPS 与缓存未删除。")
		return
	}
	a.applyMapFeatureAvailability()
	a.syncMenuChecks()
	queued := a.resumeMapMetadataAnalysis()
	setText(a.hStatusText, fmt.Sprintf("地图与位置功能已启用；地图将在首次切换视图时加载，已安排 %d 个待补充位置的任务。", queued))
}

func (a *application) resumeMapMetadataAnalysis() int {
	if a == nil || !a.mapFeaturesEnabled() {
		return 0
	}
	ids := make([]int64, 0)
	a.mu.Lock()
	for _, task := range a.tasks {
		if task == nil {
			continue
		}
		complete := task.Location.Valid() && task.Location.PlaceChecked && strings.TrimSpace(task.CaptureTime) != ""
		if !complete {
			ids = append(ids, task.ID)
		}
	}
	a.mu.Unlock()
	queued := 0
	for _, id := range ids {
		if a.queueMediaMetadata(id) {
			queued++
		}
	}
	return queued
}

func (a *application) syncSelectedTaskToMap() {
	if a == nil || !a.mapFeaturesEnabled() || (a.viewMode != mapViewSplit && a.viewMode != mapViewSidebar) {
		return
	}
	runtime := mapRuntimeFor(a)
	if runtime == nil {
		return
	}
	indices := a.selectedTaskIndices()
	if len(indices) != 1 {
		runtime.setCurrentTask(0)
		return
	}
	a.mu.Lock()
	index := indices[0]
	if index < 0 || index >= len(a.tasks) || a.tasks[index] == nil {
		a.mu.Unlock()
		runtime.setCurrentTask(0)
		return
	}
	task := *a.tasks[index]
	a.mu.Unlock()
	changed := runtime.setCurrentTask(task.ID)
	if changed && task.Location.Valid() {
		runtime.focus(task.Location.Longitude, task.Location.Latitude)
	}
}
