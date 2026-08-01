//go:build windows

package media

import (
	"path/filepath"
	"syscall"
	"unsafe"
)

var procGetDiskFreeSpaceExW = syscall.NewLazyDLL("kernel32.dll").NewProc("GetDiskFreeSpaceExW")

func AvailableDiskBytes(path string) (uint64, error) {
	root := filepath.VolumeName(filepath.Clean(path))
	if root == "" {
		root = path
	} else {
		root += `\`
	}
	ptr, err := syscall.UTF16PtrFromString(root)
	if err != nil {
		return 0, err
	}
	var freeAvailable, total, totalFree uint64
	r, _, e := procGetDiskFreeSpaceExW.Call(uintptr(unsafe.Pointer(ptr)), uintptr(unsafe.Pointer(&freeAvailable)), uintptr(unsafe.Pointer(&total)), uintptr(unsafe.Pointer(&totalFree)))
	if r == 0 {
		return 0, e
	}
	return freeAvailable, nil
}
