//go:build windows

package main

import (
	"fmt"
	"runtime"
	"strings"
	"syscall"
	"time"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/workflow"
)

const (
	portableAuthorityWHGetMessage = 3
	portableAuthorityGWLPWndProc  = ^uintptr(3)
)

var (
	portableAuthorityUser32            = syscall.NewLazyDLL("user32.dll")
	portableAuthorityKernel32          = syscall.NewLazyDLL("kernel32.dll")
	portableAuthoritySetWindowsHookExW = portableAuthorityUser32.NewProc("SetWindowsHookExW")
	portableAuthorityCallNextHookEx    = portableAuthorityUser32.NewProc("CallNextHookEx")
	portableAuthorityUnhookWindowsHook = portableAuthorityUser32.NewProc("UnhookWindowsHookEx")
	portableAuthoritySetWindowLongPtrW = portableAuthorityUser32.NewProc("SetWindowLongPtrW")
	portableAuthorityCallWindowProcW   = portableAuthorityUser32.NewProc("CallWindowProcW")
	portableAuthorityGetThreadID       = portableAuthorityKernel32.NewProc("GetCurrentThreadId")
	portableAuthorityHook              uintptr
	portableAuthorityHookCallback      uintptr
	portableAuthorityWndProcCallback   uintptr
	portableAuthorityOldWndProc        uintptr
)

func init() {
	runtime.LockOSThread()
	portableAuthorityHookCallback = syscall.NewCallback(portableAuthorityGetMessageProc)
	threadID, _, _ := portableAuthorityGetThreadID.Call()
	hook, _, _ := portableAuthoritySetWindowsHookExW.Call(
		portableAuthorityWHGetMessage,
		portableAuthorityHookCallback,
		0,
		threadID,
	)
	portableAuthorityHook = hook
}

func portableAuthorityGetMessageProc(code, wParam, lParam uintptr) uintptr {
	hook := portableAuthorityHook
	if int32(code) >= 0 {
		current := app
		if current != nil && current.controlsReady && current.hwnd != 0 {
			if !current.selfTest && !current.uiPreview {
				portableAuthorityWndProcCallback = syscall.NewCallback(portableAuthorityWndProc)
				oldProc, _, callErr := portableAuthoritySetWindowLongPtrW.Call(
					current.hwnd,
					portableAuthorityGWLPWndProc,
					portableAuthorityWndProcCallback,
				)
				if oldProc != 0 {
					portableAuthorityOldWndProc = oldProc
				} else if callErr != nil && callErr != syscall.Errno(0) {
					text := "便携模式安全切换接管未能启用；本次请勿切换便携模式：" + compactPersistenceText(callErr.Error(), 100)
					current.runtimeNotice = mergeStartupRuntimeNotice(current.runtimeNotice, text)
					setText(current.hStatusText, text)
				}
			}
			if hook != 0 {
				portableAuthorityUnhookWindowsHook.Call(hook)
				portableAuthorityHook = 0
			}
		}
	}
	next, _, _ := portableAuthorityCallNextHookEx.Call(hook, code, wParam, lParam)
	return next
}

func portableAuthorityWndProc(hwnd, message, wParam, lParam uintptr) uintptr {
	if message == WM_COMMAND && int(wParam&0xffff) == ID_SET_PORTABLE_MODE {
		handlePortableModeAuthoritySwitch(app)
		return 0
	}
	if portableAuthorityOldWndProc == 0 {
		return 0
	}
	result, _, _ := portableAuthorityCallWindowProcW.Call(
		portableAuthorityOldWndProc,
		hwnd,
		message,
		wParam,
		lParam,
	)
	return result
}

func portableModeRunActive(current *application) bool {
	current.runMu.Lock()
	defer current.runMu.Unlock()
	return current.running
}

func flushPortableModeSource(current *application, now time.Time) error {
	current.readSettingsFromUI()
	if err := config.Save(current.settings); err != nil {
		return fmt.Errorf("保存当前配置: %w", err)
	}
	if !current.settings.RestoreSession {
		return nil
	}
	path, err := config.SessionPath()
	if err != nil {
		return err
	}
	tasks := snapshotRuntimeTasks(current)
	envelope := workflow.NewSessionEnvelope(tasks, appVersion, false, "portable_mode_switch", now)
	if err := workflow.SaveSessionAtomic(path, envelope); err != nil {
		return fmt.Errorf("保存当前任务会话: %w", err)
	}
	return nil
}

func portableModeSwitchPrompt(enable bool) string {
	if enable {
		return "确定启用便携模式？\r\n\r\n当前配置、任务会话和历史记录会先写入 EXE 同目录的 MediovaData。目标位置已有数据时会先完整备份，再以当前数据为准；普通 AppData 原数据不会删除。\r\n\r\n准备完成后需要重启 Mediova。"
	}
	return "确定关闭便携模式？\r\n\r\n当前便携配置、任务会话和历史记录会先写回 AppData。AppData 中已有数据会先完整备份，再以当前便携数据为准；MediovaData 原数据不会删除。\r\n\r\n准备完成后需要重启 Mediova。"
}

func handlePortableModeAuthoritySwitch(current *application) {
	if current == nil || current.hwnd == 0 {
		return
	}
	if portableModeRunActive(current) {
		messageBox(
			current.hwnd,
			"便携模式",
			"转换任务运行中不能切换数据模式。请先等待任务完成或停止当前任务，再重新操作。",
			MB_OK|MB_ICONWARNING,
		)
		return
	}

	enable := !config.PortableModeEnabled()
	if messageBox(current.hwnd, "便携模式", portableModeSwitchPrompt(enable), MB_YESNO|MB_ICONQUESTION) != IDYES {
		return
	}
	now := time.Now()
	if err := flushPortableModeSource(current, now); err != nil {
		messageBox(
			current.hwnd,
			"便携模式切换失败",
			"当前数据未能完整保存，模式标记没有改变。\r\n\r\n"+compactPersistenceText(err.Error(), 300),
			MB_OK|MB_ICONERROR,
		)
		return
	}

	result, err := config.PreparePortableModeSwitch(enable, current.settings, now)
	if err != nil {
		messageBox(
			current.hwnd,
			"便携模式切换失败",
			"目标数据准备失败，模式标记没有改变，原数据保持不变。\r\n\r\n"+compactPersistenceText(err.Error(), 300),
			MB_OK|MB_ICONERROR,
		)
		return
	}
	if err := config.SetPortableMode(enable); err != nil {
		messageBox(
			current.hwnd,
			"便携模式切换失败",
			"目标数据已安全准备，但模式标记未能改变；本次仍继续使用原数据位置。\r\n\r\n"+compactPersistenceText(err.Error(), 300),
			MB_OK|MB_ICONERROR,
		)
		return
	}

	current.syncMenuChecks()
	summary := config.PortableModeSwitchSummary(result)
	if result.BackupDir != "" {
		summary += "\r\n\r\n目标旧数据备份位置：\r\n" + result.BackupDir
	}
	current.runtimeNotice = mergeStartupRuntimeNotice(current.runtimeNotice, strings.ReplaceAll(summary, "\r\n", " "))
	setText(current.hStatusText, compactPersistenceText(strings.ReplaceAll(summary, "\r\n", " "), 220))
	messageBox(current.hwnd, "便携模式", summary, MB_OK|MB_ICONINFORMATION)
}
