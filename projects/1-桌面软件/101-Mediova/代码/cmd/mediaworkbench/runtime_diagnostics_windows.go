//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/model"
)

const (
	runtimeIncidentLimit = 2 << 20
	runtimeIncidentKeep  = 8
)

var runtimeIncidentMu sync.Mutex

var (
	runtimeDiagPSAPI                 = syscall.NewLazyDLL("psapi.dll")
	runtimeDiagGetProcessMemoryInfo  = runtimeDiagPSAPI.NewProc("GetProcessMemoryInfo")
	runtimeDiagGetCurrentProcess     = kernel32.NewProc("GetCurrentProcess")
	runtimeDiagGetProcessHandleCount = kernel32.NewProc("GetProcessHandleCount")
	runtimeDiagGlobalMemoryStatusEx  = kernel32.NewProc("GlobalMemoryStatusEx")
	runtimeDiagGetGuiResources       = user32.NewProc("GetGuiResources")
)

type runtimeProcessMemoryCounters struct {
	CB                         uint32
	PageFaultCount             uint32
	PeakWorkingSetSize         uintptr
	WorkingSetSize             uintptr
	QuotaPeakPagedPoolUsage    uintptr
	QuotaPagedPoolUsage        uintptr
	QuotaPeakNonPagedPoolUsage uintptr
	QuotaNonPagedPoolUsage     uintptr
	PagefileUsage              uintptr
	PeakPagefileUsage          uintptr
	PrivateUsage               uintptr
}

type runtimeMemoryStatus struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhysical        uint64
	AvailablePhysical    uint64
	TotalPageFile        uint64
	AvailablePageFile    uint64
	TotalVirtual         uint64
	AvailableVirtual     uint64
	AvailableExtendedVir uint64
}

type runtimeHealthSnapshot struct {
	RunID           string         `json:"run_id"`
	Version         string         `json:"version"`
	PID             int            `json:"pid"`
	StartedAt       time.Time      `json:"started_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	CleanExit       bool           `json:"clean_exit"`
	ExitReason      string         `json:"exit_reason,omitempty"`
	Goroutines      int            `json:"goroutines"`
	HeapAllocBytes  uint64         `json:"heap_alloc_bytes"`
	HeapSysBytes    uint64         `json:"heap_sys_bytes"`
	SysBytes        uint64         `json:"sys_bytes"`
	WorkingSetBytes uint64         `json:"working_set_bytes"`
	PrivateBytes    uint64         `json:"private_bytes"`
	ProcessHandles  uint32         `json:"process_handles"`
	GDIHandles      uint32         `json:"gdi_handles"`
	UserHandles     uint32         `json:"user_handles"`
	MemoryLoadPct   uint32         `json:"memory_load_percent"`
	AvailableRAM    uint64         `json:"available_physical_bytes"`
	AvailableCommit uint64         `json:"available_commit_bytes"`
	TaskCount       int            `json:"task_count"`
	TaskStates      map[string]int `json:"task_states,omitempty"`
	ProbeQueued     int            `json:"probe_queued"`
	ThumbnailQueued int            `json:"thumbnail_queued"`
	MetadataQueued  int            `json:"metadata_queued"`
	HistoryQueued   int            `json:"history_thumbnail_queued"`
	ProbeDropped    int64          `json:"probe_queue_dropped"`
	ThumbDropped    int64          `json:"thumbnail_queue_dropped"`
	MetadataDropped int64          `json:"metadata_queue_dropped"`
	HistoryDropped  int64          `json:"history_thumbnail_dropped"`
	PerformanceMode string         `json:"performance_mode"`
	PressureReason  string         `json:"pressure_reason,omitempty"`
	ActiveVideoRuns int            `json:"active_video_runs"`
	ActiveImageRuns int            `json:"active_image_runs"`
}

func runtimeStatePath() (string, error) {
	dir, err := config.Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "runtime-state.json"), nil
}

func runtimeIncidentPath() (string, error) {
	dir, err := config.Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "incidents.log"), nil
}

func snapshotProcessHealth(runID string, started time.Time, clean bool, reason string) runtimeHealthSnapshot {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	s := runtimeHealthSnapshot{
		RunID: runID, Version: appVersion, PID: os.Getpid(), StartedAt: started,
		UpdatedAt: time.Now(), CleanExit: clean, ExitReason: reason,
		Goroutines: runtime.NumGoroutine(), HeapAllocBytes: mem.HeapAlloc,
		HeapSysBytes: mem.HeapSys, SysBytes: mem.Sys, TaskStates: make(map[string]int),
	}
	process, _, _ := runtimeDiagGetCurrentProcess.Call()
	if process != 0 {
		var counters runtimeProcessMemoryCounters
		counters.CB = uint32(unsafe.Sizeof(counters))
		if ok, _, _ := runtimeDiagGetProcessMemoryInfo.Call(process, uintptr(unsafe.Pointer(&counters)), uintptr(counters.CB)); ok != 0 {
			s.WorkingSetBytes = uint64(counters.WorkingSetSize)
			s.PrivateBytes = uint64(counters.PrivateUsage)
		}
		var handles uint32
		if ok, _, _ := runtimeDiagGetProcessHandleCount.Call(process, uintptr(unsafe.Pointer(&handles))); ok != 0 {
			s.ProcessHandles = handles
		}
		if value, _, _ := runtimeDiagGetGuiResources.Call(process, 0); value != 0 {
			s.GDIHandles = uint32(value)
		}
		if value, _, _ := runtimeDiagGetGuiResources.Call(process, 1); value != 0 {
			s.UserHandles = uint32(value)
		}
	}
	if memory, ok := readRuntimeMemoryStatus(); ok {
		s.MemoryLoadPct = memory.MemoryLoad
		s.AvailableRAM = memory.AvailablePhysical
		s.AvailableCommit = memory.AvailablePageFile
	}
	return s
}

func readRuntimeMemoryStatus() (runtimeMemoryStatus, bool) {
	var memory runtimeMemoryStatus
	memory.Length = uint32(unsafe.Sizeof(memory))
	ok, _, _ := runtimeDiagGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&memory)))
	return memory, ok != 0
}

func runtimeMemoryWorkerCapForStatus(kind model.Kind, workers int, memory runtimeMemoryStatus) int {
	if workers < 1 {
		return 1
	}
	const gib = uint64(1024 * 1024 * 1024)
	capWorkers := workers
	switch {
	case memory.MemoryLoad >= 92 || memory.AvailablePhysical < gib || memory.AvailablePageFile < gib:
		capWorkers = 1
	case memory.MemoryLoad >= 85 || memory.AvailablePhysical < 2*gib || memory.AvailablePageFile < 2*gib:
		if capWorkers > 2 {
			capWorkers = 2
		}
	case kind == model.KindImage && (memory.MemoryLoad >= 78 || memory.AvailablePhysical < 4*gib || memory.AvailablePageFile < 4*gib):
		if capWorkers > 3 {
			capWorkers = 3
		}
	}
	return capWorkers
}

func runtimeMemoryWorkerCap(kind model.Kind, workers int) int {
	memory, ok := readRuntimeMemoryStatus()
	if ok {
		workers = runtimeMemoryWorkerCapForStatus(kind, workers, memory)
	}
	if app != nil {
		workers = performanceWorkerCap(app.settings.PerformanceMode, kind, workers)
	}
	return workers
}

func runtimePressureReason(s runtimeHealthSnapshot) string {
	reasons := make([]string, 0, 4)
	if s.MemoryLoadPct >= 90 || (s.AvailableRAM > 0 && s.AvailableRAM < 1024*1024*1024) {
		reasons = append(reasons, "系统内存紧张")
	}
	if s.ProcessHandles >= 8000 || s.GDIHandles >= 8000 || s.UserHandles >= 8000 {
		reasons = append(reasons, "Windows句柄接近安全上限")
	}
	if s.ProbeQueued >= 15000 || s.ThumbnailQueued >= 7600 || s.MetadataQueued >= 7600 || s.HistoryQueued >= 1900 {
		reasons = append(reasons, "后台队列接近容量")
	}
	if s.Goroutines >= 2000 {
		reasons = append(reasons, "后台协程异常增多")
	}
	return strings.Join(reasons, "；")
}

func runtimeSnapshotUnderPressure(s runtimeHealthSnapshot) bool {
	return runtimePressureReason(s) != ""
}

func snapshotRuntimeHealth(runID string, started time.Time, clean bool, reason string) runtimeHealthSnapshot {
	s := snapshotProcessHealth(runID, started, clean, reason)
	if app == nil {
		return s
	}
	app.mu.Lock()
	s.TaskCount = len(app.tasks)
	for _, task := range app.tasks {
		if task != nil {
			s.TaskStates[string(task.Status)]++
		}
	}
	app.mu.Unlock()
	if app.probeQueue != nil {
		s.ProbeQueued = len(app.probeQueue)
	}
	if app.thumbnailQueue != nil {
		s.ThumbnailQueued = len(app.thumbnailQueue)
	}
	if app.metadataQueue != nil {
		s.MetadataQueued = len(app.metadataQueue)
	}
	if app.historyThumbnailQueue != nil {
		s.HistoryQueued = len(app.historyThumbnailQueue)
	}
	s.ProbeDropped = app.probeQueueDropped.Load()
	s.ThumbDropped = app.thumbnailQueueDropped.Load()
	s.MetadataDropped = app.metadataQueueDropped.Load()
	s.HistoryDropped = app.historyThumbnailDropped.Load()
	s.PerformanceMode = model.NormalizePerformanceMode(app.settings.PerformanceMode)
	s.PressureReason = runtimePressureReason(s)
	app.runMu.Lock()
	for kind := range app.activeRuns {
		switch kind {
		case model.KindVideo:
			s.ActiveVideoRuns++
		case model.KindImage:
			s.ActiveImageRuns++
		}
	}
	app.runMu.Unlock()
	return s
}

func saveRuntimeHealth(snapshot runtimeHealthSnapshot) {
	path, err := runtimeStatePath()
	if err != nil {
		return
	}
	_ = config.SaveJSON(path, snapshot)
}

func readRuntimeHealth() (runtimeHealthSnapshot, error) {
	var snapshot runtimeHealthSnapshot
	path, err := runtimeStatePath()
	if err != nil {
		return snapshot, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return snapshot, err
	}
	return snapshot, json.Unmarshal(data, &snapshot)
}

func startRuntimeDiagnostics(disabled bool) func(bool) {
	if disabled {
		return func(bool) {}
	}
	if previous, err := readRuntimeHealth(); err == nil && !previous.CleanExit && previous.RunID != "" {
		writeRuntimeIncident("unclean_exit", "previous process disappeared without a clean shutdown", previous, nil)
	}
	started := time.Now()
	runID := fmt.Sprintf("%s-%d", started.Format("20060102T150405.000"), os.Getpid())
	saveRuntimeHealth(snapshotRuntimeHealth(runID, started, false, "running"))
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(15 * time.Second)
		var lastPressure time.Time
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				snapshot := snapshotRuntimeHealth(runID, started, false, "running")
				saveRuntimeHealth(snapshot)
				if runtimeSnapshotUnderPressure(snapshot) && (lastPressure.IsZero() || time.Since(lastPressure) >= 2*time.Minute) {
					lastPressure = time.Now()
					writeRuntimeIncident("resource_pressure", snapshot.PressureReason, snapshot, nil)
				}
			case <-stop:
				return
			}
		}
	}()
	return func(clean bool) {
		close(stop)
		<-done
		reason := "unclean"
		if clean {
			reason = "normal_exit"
		}
		saveRuntimeHealth(snapshotRuntimeHealth(runID, started, clean, reason))
	}
}

func rotateRuntimeIncidentLog(path string) {
	info, err := os.Stat(path)
	if err != nil || info.Size() < runtimeIncidentLimit {
		return
	}
	for i := runtimeIncidentKeep - 1; i >= 1; i-- {
		oldPath := fmt.Sprintf("%s.%d", path, i)
		newPath := fmt.Sprintf("%s.%d", path, i+1)
		_ = os.Remove(newPath)
		_ = os.Rename(oldPath, newPath)
	}
	_ = os.Remove(path + ".1")
	_ = os.Rename(path, path+".1")
}

func writeRuntimeIncident(kind, stage string, value any, stack []byte) {
	runtimeIncidentMu.Lock()
	defer runtimeIncidentMu.Unlock()
	path, err := runtimeIncidentPath()
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	rotateRuntimeIncidentLog(path)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	stage = strings.ReplaceAll(strings.TrimSpace(stage), "\r", " ")
	stage = strings.ReplaceAll(stage, "\n", " ")
	_, _ = fmt.Fprintf(f, "\r\n=== %s | %s | v%s | pid %d ===\r\nstage: %s\r\nerror: %v\r\n", time.Now().Format(time.RFC3339Nano), kind, appVersion, os.Getpid(), stage, value)
	if len(stack) > 0 {
		_, _ = fmt.Fprintf(f, "stack:\r\n%s\r\n", stack)
	}
	if health, marshalErr := json.Marshal(snapshotProcessHealth("incident", time.Now(), false, kind)); marshalErr == nil {
		_, _ = fmt.Fprintf(f, "health: %s\r\n", health)
	}
	_ = f.Sync()

	// crash.log remains a compatibility pointer to the newest serious event.
	// Recoverable thumbnail/probe errors only append to incidents.log.
	if kind == "panic" || kind == "unclean_exit" {
		if crashPath, crashErr := config.CrashPath(); crashErr == nil {
			latest := fmt.Sprintf("time: %s\r\nversion: %s\r\nkind: %s\r\nstage: %s\r\nerror: %v\r\n\r\nstack:\r\n%s", time.Now().Format(time.RFC3339Nano), appVersion, kind, stage, value, stack)
			_ = os.WriteFile(crashPath, []byte(latest), 0o644)
		}
	}
}

func writeRuntimeError(stage string, err any) {
	writeRuntimeIncident("recoverable_error", stage, err, nil)
}
