//go:build windows

package media

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

const (
	genericRead             = 0x80000000
	genericWrite            = 0x40000000
	fileShareRead           = 0x1
	fileShareWrite          = 0x2
	fileShareDelete         = 0x4
	openExisting            = 3
	fileAttributeNormal     = 0x80
	fileFlagBackupSemantics = 0x02000000
)

type filetime struct{ LowDateTime, HighDateTime uint32 }

var k32times = syscall.NewLazyDLL("kernel32.dll")
var procCreateFileWTimes = k32times.NewProc("CreateFileW")
var procGetFileTime = k32times.NewProc("GetFileTime")
var procSetFileTime = k32times.NewProc("SetFileTime")
var procCloseHandleTimes = k32times.NewProc("CloseHandle")

func openTimeHandle(path string, access uintptr) (uintptr, error) {
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	flags := uintptr(fileAttributeNormal)
	if info, statErr := os.Stat(path); statErr == nil && info.IsDir() {
		flags |= fileFlagBackupSemantics
	}
	h, _, e := procCreateFileWTimes.Call(uintptr(unsafe.Pointer(p)), access, fileShareRead|fileShareWrite|fileShareDelete, 0, openExisting, flags, 0)
	if h == 0 || h == ^uintptr(0) {
		return 0, fmt.Errorf("CreateFileW: %v", e)
	}
	return h, nil
}

func preserveTimesPlatform(src, dst string) error {
	hs, err := openTimeHandle(src, genericRead)
	if err != nil {
		return err
	}
	defer procCloseHandleTimes.Call(hs)
	hd, err := openTimeHandle(dst, genericWrite)
	if err != nil {
		return err
	}
	defer procCloseHandleTimes.Call(hd)
	var creation, access, write filetime
	r, _, e := procGetFileTime.Call(hs, uintptr(unsafe.Pointer(&creation)), uintptr(unsafe.Pointer(&access)), uintptr(unsafe.Pointer(&write)))
	if r == 0 {
		return fmt.Errorf("GetFileTime: %v", e)
	}
	r, _, e = procSetFileTime.Call(hd, uintptr(unsafe.Pointer(&creation)), uintptr(unsafe.Pointer(&access)), uintptr(unsafe.Pointer(&write)))
	if r == 0 {
		return fmt.Errorf("SetFileTime: %v", e)
	}
	return nil
}
