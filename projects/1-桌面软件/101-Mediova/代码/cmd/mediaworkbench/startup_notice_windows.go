//go:build windows

package main

import (
	"runtime"
	"syscall"

	"mediaworkbench/internal/config"
)

const startupNoticeWHGetMessage = 3

var (
	startupNoticeUser32             = syscall.NewLazyDLL("user32.dll")
	startupNoticeSetWindowsHookExW  = startupNoticeUser32.NewProc("SetWindowsHookExW")
	startupNoticeCallNextHookEx     = startupNoticeUser32.NewProc("CallNextHookEx")
	startupNoticeUnhookWindowsHook  = startupNoticeUser32.NewProc("UnhookWindowsHookEx")
	startupNoticeGetCurrentThreadID = syscall.NewLazyDLL("kernel32.dll").NewProc("GetCurrentThreadId")
	startupNoticeHook               uintptr
	startupNoticeHookCallback       uintptr
	startupNoticeText               string
)

func init() {
	notice := normalizeStartupConfigNotice(config.StartupConfigNotice())
	if notice == "" {
		return
	}

	// Package init and main run on the main goroutine. Locking here ensures the
	// thread-specific WH_GETMESSAGE hook is installed on the same UI thread that
	// main later uses for Win32 window creation and the message loop.
	runtime.LockOSThread()
	startupNoticeText = notice
	startupNoticeHookCallback = syscall.NewCallback(startupNoticeGetMessageProc)
	threadID, _, _ := startupNoticeGetCurrentThreadID.Call()
	hook, _, _ := startupNoticeSetWindowsHookExW.Call(
		startupNoticeWHGetMessage,
		startupNoticeHookCallback,
		0,
		threadID,
	)
	startupNoticeHook = hook
}

func startupNoticeGetMessageProc(code, wParam, lParam uintptr) uintptr {
	hook := startupNoticeHook
	if int32(code) >= 0 && startupNoticeText != "" {
		current := app
		if current != nil && current.controlsReady && current.hStatusText != 0 {
			notice := startupNoticeText
			current.runtimeNotice = mergeStartupRuntimeNotice(current.runtimeNotice, notice)
			if !current.selfTest && !current.uiPreview && startupStatusAllowsConfigNotice(getText(current.hStatusText)) {
				setText(current.hStatusText, notice)
			}
			startupNoticeText = ""
			if hook != 0 {
				startupNoticeUnhookWindowsHook.Call(hook)
				startupNoticeHook = 0
			}
		}
	}
	next, _, _ := startupNoticeCallNextHookEx.Call(hook, code, wParam, lParam)
	return next
}
