//go:build windows

package main

// v452DestroyImportToast follows the existing toast lifecycle: destruction
// triggers WM_NCDESTROY, which releases timers, subclass state and the global
// toast handle. It is kept local to the round-five verification fallback.
func v452DestroyImportToast(hwnd uintptr) {
	if hwnd != 0 {
		procDestroyWindow.Call(hwnd)
	}
}
