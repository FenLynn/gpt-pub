//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/model"
)

const (
	statusDiagnosticWHGetMessage = 3
	statusDiagnosticGWLPWndProc   = ^uintptr(3)
	statusDiagnosticWMSetText     = 0x000C
)

var (
	statusDiagnosticUser32            = syscall.NewLazyDLL("user32.dll")
	statusDiagnosticKernel32          = syscall.NewLazyDLL("kernel32.dll")
	statusDiagnosticSetWindowsHookExW = statusDiagnosticUser32.NewProc("SetWindowsHookExW")
	statusDiagnosticCallNextHookEx    = statusDiagnosticUser32.NewProc("CallNextHookEx")
	statusDiagnosticUnhookWindowsHook = statusDiagnosticUser32.NewProc("UnhookWindowsHookEx")
	statusDiagnosticSetWindowLongPtrW = statusDiagnosticUser32.NewProc("SetWindowLongPtrW")
	statusDiagnosticCallWindowProcW   = statusDiagnosticUser32.NewProc("CallWindowProcW")
	statusDiagnosticGetThreadID       = statusDiagnosticKernel32.NewProc("GetCurrentThreadId")
	statusDiagnosticHook              uintptr
	statusDiagnosticHookCallback      uintptr
	statusDiagnosticMainCallback      uintptr
	statusDiagnosticStatusCallback    uintptr
	statusDiagnosticOldMainProc       uintptr
	statusDiagnosticOldStatusProc     uintptr
	statusDiagnosticLatest            string
	statusDiagnosticVisible           bool
)

func init() {
	runtime.LockOSThread()
	statusDiagnosticHookCallback = syscall.NewCallback(statusDiagnosticGetMessageProc)
	threadID, _, _ := statusDiagnosticGetThreadID.Call()
	hook, _, _ := statusDiagnosticSetWindowsHookExW.Call(
		statusDiagnosticWHGetMessage,
		statusDiagnosticHookCallback,
		0,
		threadID,
	)
	statusDiagnosticHook = hook
}

func statusDiagnosticGetMessageProc(code, wParam, lParam uintptr) uintptr {
	hook := statusDiagnosticHook
	if int32(code) >= 0 {
		current := app
		if current != nil && current.controlsReady && current.hwnd != 0 && current.hStatusText != 0 {
			if !current.selfTest && !current.uiPreview {
				statusDiagnosticMainCallback = syscall.NewCallback(statusDiagnosticMainWndProc)
				statusDiagnosticStatusCallback = syscall.NewCallback(statusDiagnosticStatusWndProc)
				mainOld, _, mainErr := statusDiagnosticSetWindowLongPtrW.Call(
					current.hwnd,
					statusDiagnosticGWLPWndProc,
					statusDiagnosticMainCallback,
				)
				statusOld, _, statusErr := statusDiagnosticSetWindowLongPtrW.Call(
					current.hStatusText,
					statusDiagnosticGWLPWndProc,
					statusDiagnosticStatusCallback,
				)
				if mainOld != 0 {
					statusDiagnosticOldMainProc = mainOld
				}
				if statusOld != 0 {
					statusDiagnosticOldStatusProc = statusOld
				}
				if statusDiagnosticOldMainProc == 0 || statusDiagnosticOldStatusProc == 0 {
					detail := "状态栏诊断摘要未能完整启用"
					if mainErr != nil && mainErr != syscall.Errno(0) {
						detail += "；主窗口：" + mainErr.Error()
					}
					if statusErr != nil && statusErr != syscall.Errno(0) {
						detail += "；状态控件：" + statusErr.Error()
					}
					current.runtimeNotice = mergeStartupRuntimeNotice(current.runtimeNotice, detail)
				}
			}
			if hook != 0 {
				statusDiagnosticUnhookWindowsHook.Call(hook)
				statusDiagnosticHook = 0
			}
		}
	}
	next, _, _ := statusDiagnosticCallNextHookEx.Call(hook, code, wParam, lParam)
	return next
}

func statusDiagnosticMainWndProc(hwnd, message, wParam, lParam uintptr) uintptr {
	if message == WM_COMMAND && int(wParam&0xffff) == ID_HELP_DIAGNOSTICS {
		if current := app; current != nil {
			current.writeDiagnosticsWithRuntimeNotice()
		}
		return 0
	}
	if statusDiagnosticOldMainProc == 0 {
		return 0
	}
	result, _, _ := statusDiagnosticCallWindowProcW.Call(
		statusDiagnosticOldMainProc,
		hwnd,
		message,
		wParam,
		lParam,
	)
	return result
}

func statusDiagnosticControlWidth(hwnd uintptr) int32 {
	var bounds rect
	if ok, _, _ := procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&bounds))); ok == 0 {
		return 240
	}
	width := bounds.Right - bounds.Left
	if width < 1 {
		return 240
	}
	return width
}

func statusDiagnosticFullDetail() string {
	latest := normalizeDiagnosticStatusText(statusDiagnosticLatest)
	if current := app; current != nil {
		if runtimeNotice := normalizeDiagnosticStatusText(current.runtimeNotice); runtimeNotice != "" {
			latest = runtimeNotice
		}
	}
	return diagnosticStatusDetailText(latest)
}

func statusDiagnosticStatusWndProc(hwnd, message, wParam, lParam uintptr) uintptr {
	if message == statusDiagnosticWMSetText && lParam != 0 {
		full := syscall.UTF16PtrToString((*uint16)(unsafe.Pointer(lParam)))
		if isDiagnosticStatusText(full) {
			statusDiagnosticLatest = normalizeDiagnosticStatusText(full)
			statusDiagnosticVisible = true
			summary := diagnosticStatusSummary(full, statusDiagnosticControlWidth(hwnd))
			pointer, err := syscall.UTF16PtrFromString(summary)
			if err == nil && statusDiagnosticOldStatusProc != 0 {
				result, _, _ := statusDiagnosticCallWindowProcW.Call(
					statusDiagnosticOldStatusProc,
					hwnd,
					message,
					wParam,
					uintptr(unsafe.Pointer(pointer)),
				)
				return result
			}
		} else {
			statusDiagnosticVisible = false
		}
	}
	if (message == WM_LBUTTONUP || message == WM_CONTEXTMENU) && statusDiagnosticVisible {
		current := app
		owner := uintptr(0)
		if current != nil {
			owner = current.hwnd
		}
		messageBox(owner, "运行状态详情", statusDiagnosticFullDetail(), MB_OK|MB_ICONINFORMATION)
		return 0
	}
	if statusDiagnosticOldStatusProc == 0 {
		return 0
	}
	result, _, _ := statusDiagnosticCallWindowProcW.Call(
		statusDiagnosticOldStatusProc,
		hwnd,
		message,
		wParam,
		lParam,
	)
	return result
}

func (a *application) writeDiagnosticsWithRuntimeNotice() {
	dir, err := config.Dir()
	if err != nil {
		messageBox(a.hwnd, "诊断报告", err.Error(), MB_OK|MB_ICONERROR)
		return
	}
	path := filepath.Join(dir, fmt.Sprintf("diagnostics_%s.txt", time.Now().Format("20060102_150405")))
	a.mu.Lock()
	tasks := make([]model.Task, 0, len(a.tasks))
	for _, task := range a.tasks {
		if task != nil {
			tasks = append(tasks, *task)
		}
	}
	a.mu.Unlock()
	settingsJSON, _ := json.MarshalIndent(a.settings, "", "  ")
	tasksJSON, _ := json.MarshalIndent(tasks, "", "  ")
	ffmpeg, ffprobe, hardware, player, _ := a.componentSnapshot()
	runtimeDir, _ := config.RuntimeDir()
	roamingDir, _ := config.Dir()
	localDir, _ := config.LocalDir()
	manifestState := "未验证"
	if validationErr := config.ValidateRuntimeManifest(appVersion); validationErr == nil {
		manifestState = "通过"
	} else {
		manifestState = validationErr.Error()
	}
	notice := normalizeDiagnosticStatusText(a.runtimeNotice)
	if notice == "" {
		notice = normalizeDiagnosticStatusText(statusDiagnosticLatest)
	}
	if notice == "" {
		notice = "无"
	}
	categories := diagnosticStatusCategories(notice)
	categoryText := "无"
	if len(categories) > 0 {
		categoryText = strings.Join(categories, "、")
	}
	text := fmt.Sprintf(
		"Mediova诊断报告\r\n生成时间：%s\r\n版本：%s\r\n系统：%s/%s\r\n逻辑处理器：%d\r\nRuntime：%s\r\nRoaming Data：%s\r\nLocal Data：%s\r\nRuntime Manifest：%s\r\n\r\n运行状态详情：\r\n%s\r\n诊断类别：%s\r\n\r\nFFmpeg：%s\r\nFFprobe：%s\r\nGPU：%s\r\nPotPlayer：%s\r\n\r\n配置：\r\n%s\r\n\r\n任务快照：\r\n%s\r\n",
		time.Now().Format("2006-01-02 15:04:05"),
		appVersion,
		runtime.GOOS,
		runtime.GOARCH,
		runtime.NumCPU(),
		runtimeDir,
		roamingDir,
		localDir,
		manifestState,
		notice,
		categoryText,
		ffmpeg,
		ffprobe,
		hardware.Detail,
		player,
		settingsJSON,
		tasksJSON,
	)
	if crashPath, crashErr := config.CrashPath(); crashErr == nil {
		if crashData, readErr := os.ReadFile(crashPath); readErr == nil {
			text += "\r\n最近崩溃记录：\r\n" + string(crashData) + "\r\n"
		}
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		messageBox(a.hwnd, "诊断报告", err.Error(), MB_OK|MB_ICONERROR)
		return
	}
	setClipboardText(a.hwnd, path)
	shellOpen(path)
	messageBox(a.hwnd, "诊断报告", "诊断报告已生成并打开；完整运行状态已写入报告，文件路径已复制到剪贴板。", MB_OK|MB_ICONINFORMATION)
}
