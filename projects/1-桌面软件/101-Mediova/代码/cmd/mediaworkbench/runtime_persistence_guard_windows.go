//go:build windows

package main

import (
	"errors"
	"os"
	"runtime"
	"sort"
	"strings"
	"syscall"
	"time"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
	"mediaworkbench/internal/workflow"
)

const (
	runtimePersistenceWHGetMessage = 3
	runtimePersistenceIntervalMS   = 1500
)

var (
	runtimePersistenceUser32            = syscall.NewLazyDLL("user32.dll")
	runtimePersistenceSetWindowsHookExW = runtimePersistenceUser32.NewProc("SetWindowsHookExW")
	runtimePersistenceCallNextHookEx    = runtimePersistenceUser32.NewProc("CallNextHookEx")
	runtimePersistenceUnhookWindowsHook = runtimePersistenceUser32.NewProc("UnhookWindowsHookEx")
	runtimePersistenceGetThreadID       = syscall.NewLazyDLL("kernel32.dll").NewProc("GetCurrentThreadId")
	runtimePersistenceHook              uintptr
	runtimePersistenceHookCallback      uintptr
	runtimePersistenceTimerCallback     uintptr
	runtimePersistenceTimerID           uintptr
	runtimePersistenceState             runtimePersistenceGuard
)

type runtimePersistenceGuard struct {
	Initialized         bool
	SettingsFingerprint string
	TasksFingerprint    string
	TerminalSignatures  map[string]bool
	Notices             persistenceNoticeState
}

func init() {
	// Keep installation on the same UI thread as the existing startup-notice
	// hook. No background goroutine polls the global application object.
	runtime.LockOSThread()
	runtimePersistenceHookCallback = syscall.NewCallback(runtimePersistenceGetMessageProc)
	threadID, _, _ := runtimePersistenceGetThreadID.Call()
	hook, _, _ := runtimePersistenceSetWindowsHookExW.Call(
		runtimePersistenceWHGetMessage,
		runtimePersistenceHookCallback,
		0,
		threadID,
	)
	runtimePersistenceHook = hook
}

func runtimePersistenceGetMessageProc(code, wParam, lParam uintptr) uintptr {
	hook := runtimePersistenceHook
	if int32(code) >= 0 {
		current := app
		if current != nil && current.controlsReady && current.hStatusText != 0 {
			if !current.selfTest && !current.uiPreview {
				runtimePersistenceTimerCallback = syscall.NewCallback(runtimePersistenceTimerProc)
				timerID, _, _ := procSetTimer.Call(
					current.hwnd,
					0,
					runtimePersistenceIntervalMS,
					runtimePersistenceTimerCallback,
				)
				runtimePersistenceTimerID = timerID
			}
			if hook != 0 {
				runtimePersistenceUnhookWindowsHook.Call(hook)
				runtimePersistenceHook = 0
			}
		}
	}
	next, _, _ := runtimePersistenceCallNextHookEx.Call(hook, code, wParam, lParam)
	return next
}

func runtimePersistenceTimerProc(hwnd, message, timerID, tick uintptr) uintptr {
	current := app
	if current == nil || current.hwnd == 0 || current.exiting || current.selfTest || current.uiPreview {
		return 0
	}
	runtimePersistenceState.tick(current, time.Now())
	return 0
}

func snapshotRuntimeTasks(current *application) []*model.Task {
	current.mu.Lock()
	defer current.mu.Unlock()
	tasks := make([]*model.Task, 0, len(current.tasks))
	for _, task := range current.tasks {
		if task != nil {
			tasks = append(tasks, workflow.CloneTask(task))
		}
	}
	return tasks
}

func terminalSignatureSet(tasks []*model.Task) map[string]bool {
	result := make(map[string]bool)
	for _, task := range tasks {
		if signature := terminalTaskSignature(task); signature != "" {
			result[signature] = true
		}
	}
	return result
}

func (guard *runtimePersistenceGuard) showFailure(current *application, kind, operation string, err error, now time.Time) {
	if err == nil || !guard.Notices.allowFailure(kind, operation, err, now) {
		return
	}
	text := persistenceFailureText(kind, operation, err)
	current.runtimeNotice = mergeStartupRuntimeNotice(current.runtimeNotice, text)
	setText(current.hStatusText, text)
}

func (guard *runtimePersistenceGuard) showRecovery(current *application, kind string) {
	if !guard.Notices.markSuccess(kind) {
		return
	}
	text := persistenceRecoveryText(kind)
	current.runtimeNotice = mergeStartupRuntimeNotice(current.runtimeNotice, text)
	setText(current.hStatusText, text)
}

func (guard *runtimePersistenceGuard) saveSettingsIfChanged(current *application, settings model.Settings, fingerprint string, now time.Time) {
	if fingerprint == guard.SettingsFingerprint {
		return
	}
	if err := config.Save(settings); err != nil {
		guard.showFailure(current, "配置", "保存", err, now)
		return
	}
	guard.SettingsFingerprint = fingerprint
	guard.showRecovery(current, "配置")
}

func (guard *runtimePersistenceGuard) saveSessionIfChanged(current *application, settings model.Settings, tasks []*model.Task, fingerprint string, now time.Time) {
	if fingerprint == guard.TasksFingerprint {
		return
	}
	if !settings.RestoreSession {
		guard.TasksFingerprint = fingerprint
		return
	}
	path, err := config.SessionPath()
	if err == nil {
		envelope := workflow.NewSessionEnvelope(tasks, appVersion, false, "runtime_guard", now)
		err = workflow.SaveSessionAtomic(path, envelope)
	}
	if err != nil {
		guard.showFailure(current, "任务会话", "保存", err, now)
		return
	}
	guard.TasksFingerprint = fingerprint
	guard.showRecovery(current, "任务会话")
}

func loadHistoryForRuntimeGuard() ([]media.HistoryRecord, error) {
	path, err := config.HistoryPath()
	if err != nil {
		return nil, err
	}
	var records []media.HistoryRecord
	err = config.LoadJSON(path, &records)
	if os.IsNotExist(err) {
		return nil, nil
	}
	return records, err
}

func unseenTerminalTasks(tasks []*model.Task, seen map[string]bool) []*model.Task {
	var result []*model.Task
	for _, task := range tasks {
		signature := terminalTaskSignature(task)
		if signature != "" && !seen[signature] {
			result = append(result, task)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].FinishedAt.Before(result[j].FinishedAt)
	})
	return result
}

func (guard *runtimePersistenceGuard) ensureHistory(current *application, settings model.Settings, tasks []*model.Task, now time.Time) {
	if guard.TerminalSignatures == nil {
		guard.TerminalSignatures = make(map[string]bool)
	}
	if !settings.SaveHistory {
		guard.TerminalSignatures = terminalSignatureSet(tasks)
		return
	}
	pending := unseenTerminalTasks(tasks, guard.TerminalSignatures)
	if len(pending) == 0 {
		return
	}
	records, err := loadHistoryForRuntimeGuard()
	if err != nil {
		guard.showFailure(current, "历史记录", "读取", err, now)
		return
	}
	for _, task := range pending {
		signature := terminalTaskSignature(task)
		if historyContainsTerminalTask(records, task) {
			guard.TerminalSignatures[signature] = true
			continue
		}
		record := terminalTaskHistoryRecord(settings, task)
		if strings.TrimSpace(record.Input) == "" {
			guard.TerminalSignatures[signature] = true
			continue
		}
		if err := media.AppendHistory(record); err != nil {
			guard.showFailure(current, "历史记录", "保存", err, now)
			return
		}
		records = append([]media.HistoryRecord{record}, records...)
		guard.TerminalSignatures[signature] = true
		guard.showRecovery(current, "历史记录")
	}
}

func (guard *runtimePersistenceGuard) tick(current *application, now time.Time) {
	if current == nil {
		return
	}
	settings := current.settings
	tasks := snapshotRuntimeTasks(current)
	settingsFingerprint := runtimeSettingsFingerprint(settings)
	tasksFingerprint := runtimeTasksFingerprint(tasks)

	if !guard.Initialized {
		guard.Initialized = true
		guard.SettingsFingerprint = settingsFingerprint
		guard.TasksFingerprint = tasksFingerprint
		guard.TerminalSignatures = terminalSignatureSet(tasks)
		return
	}
	if settingsFingerprint == "" {
		guard.showFailure(current, "配置", "序列化", errors.New("无法生成配置指纹"), now)
	} else {
		guard.saveSettingsIfChanged(current, settings, settingsFingerprint, now)
	}
	if tasksFingerprint == "" {
		guard.showFailure(current, "任务会话", "序列化", errors.New("无法生成任务队列指纹"), now)
	} else {
		guard.saveSessionIfChanged(current, settings, tasks, tasksFingerprint, now)
	}
	guard.ensureHistory(current, settings, tasks, now)
}
