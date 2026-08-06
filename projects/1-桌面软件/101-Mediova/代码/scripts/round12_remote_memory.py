from __future__ import annotations

import ctypes
from ctypes import wintypes

PROCESS_VM_OPERATION = 0x0008
PROCESS_VM_READ = 0x0010
PROCESS_VM_WRITE = 0x0020
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
MEM_COMMIT = 0x1000
MEM_RESERVE = 0x2000
MEM_RELEASE = 0x8000
PAGE_READWRITE = 0x04

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel32.OpenProcess.restype = wintypes.HANDLE
kernel32.VirtualAllocEx.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wintypes.DWORD, wintypes.DWORD]
kernel32.VirtualAllocEx.restype = ctypes.c_void_p
kernel32.VirtualFreeEx.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wintypes.DWORD]
kernel32.VirtualFreeEx.restype = wintypes.BOOL
kernel32.WriteProcessMemory.argtypes = [
    wintypes.HANDLE,
    ctypes.c_void_p,
    ctypes.c_void_p,
    ctypes.c_size_t,
    ctypes.POINTER(ctypes.c_size_t),
]
kernel32.WriteProcessMemory.restype = wintypes.BOOL
kernel32.ReadProcessMemory.argtypes = [
    wintypes.HANDLE,
    ctypes.c_void_p,
    ctypes.c_void_p,
    ctypes.c_size_t,
    ctypes.POINTER(ctypes.c_size_t),
]
kernel32.ReadProcessMemory.restype = wintypes.BOOL
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
kernel32.CloseHandle.restype = wintypes.BOOL


class RemoteMemoryBlock:
    def __init__(self, pid: int, size: int) -> None:
        rights = PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_QUERY_LIMITED_INFORMATION
        self.handle = kernel32.OpenProcess(rights, False, pid)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        self.size = size
        self.address = kernel32.VirtualAllocEx(
            self.handle,
            None,
            size,
            MEM_COMMIT | MEM_RESERVE,
            PAGE_READWRITE,
        )
        if not self.address:
            error = ctypes.get_last_error()
            kernel32.CloseHandle(self.handle)
            self.handle = None
            raise ctypes.WinError(error)

    def close(self) -> None:
        if getattr(self, "address", None):
            kernel32.VirtualFreeEx(self.handle, self.address, 0, MEM_RELEASE)
            self.address = None
        if getattr(self, "handle", None):
            kernel32.CloseHandle(self.handle)
            self.handle = None

    def write(self, address: int, source: ctypes.Structure | ctypes.Array, size: int) -> None:
        written = ctypes.c_size_t()
        if not kernel32.WriteProcessMemory(
            self.handle,
            ctypes.c_void_p(address),
            ctypes.cast(ctypes.byref(source), ctypes.c_void_p),
            size,
            ctypes.byref(written),
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        if written.value != size:
            raise RuntimeError(f"short WriteProcessMemory: {written.value} != {size}")

    def read_into(self, address: int, destination: ctypes.Structure | ctypes.Array, size: int) -> int:
        read = ctypes.c_size_t()
        if not kernel32.ReadProcessMemory(
            self.handle,
            ctypes.c_void_p(address),
            ctypes.cast(ctypes.byref(destination), ctypes.c_void_p),
            size,
            ctypes.byref(read),
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        return int(read.value)
