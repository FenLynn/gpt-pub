//go:build windows

package main

import (
	"syscall"
	"time"
	"unsafe"
)

const (
	mediovaSingleInstanceMutex = "Local\\Mediova.Desktop.SingleInstance"
	mediovaWindowClass         = "MediovaDesktop420"
	errorAlreadyExists         = syscall.Errno(183)
)

// acquireMediovaSingleInstance keeps one normal interactive Mediova process
// per Windows logon session. Native self-tests and screenshot previews are
// deliberately excluded so they can run in isolated temporary environments.
func acquireMediovaSingleInstance(skip bool) (func(), bool) {
	if skip {
		return func() {}, false
	}
	handle, _, callErr := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(p(mediovaSingleInstanceMutex))))
	if handle == 0 {
		// Starting without the guard is preferable to refusing a normal launch
		// merely because a security product blocked creation of a named mutex.
		return func() {}, false
	}
	if callErr == errorAlreadyExists {
		activateExistingMediovaWindow()
		procCloseHandle.Call(handle)
		return func() {}, true
	}
	return func() { procCloseHandle.Call(handle) }, false
}

func activateExistingMediovaWindow() {
	// A double click can race the first window's startup. Retry briefly, then
	// restore and foreground the exact main-window class rather than a toast,
	// crop dialog, or floating progress bar.
	for attempt := 0; attempt < 150; attempt++ {
		hwnd, _, _ := procFindWindowW.Call(uintptr(unsafe.Pointer(p(mediovaWindowClass))), 0)
		if hwnd != 0 {
			procShowWindow.Call(hwnd, SW_RESTORE)
			procBringWindowToTop.Call(hwnd)
			procSetForegroundWindow.Call(hwnd)
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
}
