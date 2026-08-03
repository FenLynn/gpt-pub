//go:build windows

package config

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

const (
	replaceFileWriteThrough = 0x00000002
	moveFileWriteThrough    = 0x00000008
)

var (
	atomicKernel32   = syscall.NewLazyDLL("kernel32.dll")
	atomicReplaceW  = atomicKernel32.NewProc("ReplaceFileW")
	atomicMoveFileW = atomicKernel32.NewProc("MoveFileExW")
)

func atomicWindowsCallError(operation string, callErr error) error {
	if callErr == nil || callErr == syscall.Errno(0) {
		return fmt.Errorf("%s failed", operation)
	}
	return fmt.Errorf("%s: %w", operation, callErr)
}

// replaceAtomicFile installs tempPath as path without moving path out of place
// first. ReplaceFileW guarantees that a failed replacement leaves the existing
// destination intact, which is essential when NTFS permissions or security
// software reject the operation.
func replaceAtomicFile(path, tempPath string) error {
	destination, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	temporary, err := syscall.UTF16PtrFromString(tempPath)
	if err != nil {
		return err
	}

	if _, statErr := os.Stat(path); statErr == nil {
		result, _, callErr := atomicReplaceW.Call(
			uintptr(unsafe.Pointer(destination)),
			uintptr(unsafe.Pointer(temporary)),
			0,
			replaceFileWriteThrough,
			0,
			0,
		)
		if result == 0 {
			return atomicWindowsCallError("ReplaceFileW", callErr)
		}
		return nil
	} else if !os.IsNotExist(statErr) {
		return statErr
	}

	result, _, callErr := atomicMoveFileW.Call(
		uintptr(unsafe.Pointer(temporary)),
		uintptr(unsafe.Pointer(destination)),
		moveFileWriteThrough,
	)
	if result == 0 {
		return atomicWindowsCallError("MoveFileExW", callErr)
	}
	return nil
}
