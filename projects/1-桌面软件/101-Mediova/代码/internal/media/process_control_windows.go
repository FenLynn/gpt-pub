//go:build windows

package media

import (
	"fmt"
	"syscall"
)

const (
	processSuspendResume = 0x0800
	processQueryLimited  = 0x1000
)

var ntdllControl = syscall.NewLazyDLL("ntdll.dll")
var kernelControl = syscall.NewLazyDLL("kernel32.dll")
var procNtSuspendProcess = ntdllControl.NewProc("NtSuspendProcess")
var procNtResumeProcess = ntdllControl.NewProc("NtResumeProcess")
var procOpenProcessControl = kernelControl.NewProc("OpenProcess")
var procCloseHandleControl = kernelControl.NewProc("CloseHandle")

func withProcessHandle(pid int, fn func(uintptr) uintptr) error {
	h, _, e := procOpenProcessControl.Call(processSuspendResume|processQueryLimited, 0, uintptr(uint32(pid)))
	if h == 0 {
		return fmt.Errorf("OpenProcess(%d): %v", pid, e)
	}
	defer procCloseHandleControl.Call(h)
	status := int32(fn(h))
	if status < 0 {
		return fmt.Errorf("NTSTATUS 0x%08X", uint32(status))
	}
	return nil
}

func suspendProcess(pid int) error {
	return withProcessHandle(pid, func(h uintptr) uintptr {
		r, _, _ := procNtSuspendProcess.Call(h)
		return r
	})
}

func resumeProcess(pid int) error {
	return withProcessHandle(pid, func(h uintptr) uintptr {
		r, _, _ := procNtResumeProcess.Call(h)
		return r
	})
}
