from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
from ctypes import wintypes
from pathlib import Path

import round11_flicker_gate as gate
import round11_flicker_gate_runner_base as runner


HDM_FIRST = 0x1200
HDM_GETITEMCOUNT = HDM_FIRST
HDM_GETITEMW = HDM_FIRST + 11
HDI_TEXT = 0x0002
WM_COMMAND = 0x0111
IDC_TAB_VIDEO = 1001
IDC_TAB_IMAGE = 1002

PROCESS_VM_OPERATION = 0x0008
PROCESS_VM_READ = 0x0010
PROCESS_VM_WRITE = 0x0020
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
MEM_COMMIT = 0x1000
MEM_RESERVE = 0x2000
MEM_RELEASE = 0x8000
PAGE_READWRITE = 0x04


class HDITEMW(ctypes.Structure):
    # Win64 commctrl HDITEMW. The pointer fields are target-process addresses,
    # not Python-owned strings: HDM_GETITEMW is above WM_USER, so Windows does
    # not marshal its buffers across process boundaries.
    _fields_ = [
        ("mask", ctypes.c_uint32),
        ("cxy", ctypes.c_int32),
        ("pszText", ctypes.c_void_p),
        ("hbm", ctypes.c_void_p),
        ("cchTextMax", ctypes.c_int32),
        ("fmt", ctypes.c_int32),
        ("lParam", ctypes.c_ssize_t),
        ("iImage", ctypes.c_int32),
        ("iOrder", ctypes.c_int32),
        ("type", ctypes.c_uint32),
        ("pvFilter", ctypes.c_void_p),
        ("state", ctypes.c_uint32),
    ]


if ctypes.sizeof(ctypes.c_void_p) == 8 and ctypes.sizeof(HDITEMW) != 72:
    raise RuntimeError(f"unexpected Win64 HDITEMW size: {ctypes.sizeof(HDITEMW)}")


gate.user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, ctypes.c_ssize_t]
gate.user32.SendMessageW.restype = ctypes.c_ssize_t

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


class RemoteHeaderReader:
    def __init__(self, pid: int) -> None:
        rights = PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_QUERY_LIMITED_INFORMATION
        self.handle = kernel32.OpenProcess(rights, False, pid)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        self.item_size = ctypes.sizeof(HDITEMW)
        self.text_chars = 256
        self.text_bytes = self.text_chars * ctypes.sizeof(ctypes.c_wchar)
        self.block_size = self.item_size + self.text_bytes
        self.remote_block = kernel32.VirtualAllocEx(
            self.handle,
            None,
            self.block_size,
            MEM_COMMIT | MEM_RESERVE,
            PAGE_READWRITE,
        )
        if not self.remote_block:
            error = ctypes.get_last_error()
            kernel32.CloseHandle(self.handle)
            self.handle = None
            raise ctypes.WinError(error)
        self.remote_text = int(self.remote_block) + self.item_size

    def close(self) -> None:
        if getattr(self, "remote_block", None):
            kernel32.VirtualFreeEx(self.handle, self.remote_block, 0, MEM_RELEASE)
            self.remote_block = None
        if getattr(self, "handle", None):
            kernel32.CloseHandle(self.handle)
            self.handle = None

    def _write(self, address: int, source: ctypes.Structure | ctypes.Array, size: int) -> None:
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

    def titles(self, hwnd: int) -> list[str]:
        count = int(gate.user32.SendMessageW(hwnd, HDM_GETITEMCOUNT, 0, 0))
        if count < 1:
            raise RuntimeError(f"invalid header item count: {count}")
        values: list[str] = []
        for index in range(count):
            item = HDITEMW()
            item.mask = HDI_TEXT
            item.pszText = self.remote_text
            item.cchTextMax = self.text_chars
            self._write(int(self.remote_block), item, self.item_size)
            zero_text = ctypes.create_string_buffer(self.text_bytes)
            self._write(self.remote_text, zero_text, self.text_bytes)

            result = gate.user32.SendMessageW(hwnd, HDM_GETITEMW, index, int(self.remote_block))
            if result == 0:
                raise RuntimeError(
                    f"HDM_GETITEMW failed for column {index}; sizeof(HDITEMW)={self.item_size}"
                )

            local_text = ctypes.create_string_buffer(self.text_bytes)
            read = ctypes.c_size_t()
            if not kernel32.ReadProcessMemory(
                self.handle,
                ctypes.c_void_p(self.remote_text),
                ctypes.cast(local_text, ctypes.c_void_p),
                self.text_bytes,
                ctypes.byref(read),
            ):
                raise ctypes.WinError(ctypes.get_last_error())
            raw = bytes(local_text.raw[: read.value])
            text = raw.decode("utf-16-le", errors="strict").split("\x00", 1)[0].strip()
            if not text:
                raise RuntimeError(f"empty header caption at column {index}")
            values.append(text)
        return values


def header_handle(main_hwnd: int) -> dict[str, object]:
    headers = [child for child in gate.enumerate_children(main_hwnd) if child["class"] == "SysHeader32"]
    if len(headers) != 1:
        raise RuntimeError(f"expected exactly one header, got {headers!r}")
    return headers[0]


def capture_header(header: dict[str, object], save: Path | None = None) -> str:
    image = runner.capture_screen_rect(header["rect"])
    try:
        if save is not None:
            image.save(save)
        return hashlib.sha256(image.tobytes()).hexdigest()
    finally:
        image.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    args = parser.parse_args()

    exe = args.exe.resolve()
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    isolated = Path(tempfile.mkdtemp(prefix="mediova-round12-header-"))
    env = os.environ.copy()
    env["APPDATA"] = str(isolated)
    env["LOCALAPPDATA"] = str(isolated)
    process = subprocess.Popen([str(exe), "--ui-preview=video"], cwd=str(exe.parent), env=env)
    reader: RemoteHeaderReader | None = None
    try:
        main_hwnd = gate.find_window(process.pid, "Mediova", 20.0)
        reader = RemoteHeaderReader(process.pid)
        time.sleep(1.0)
        header = header_handle(main_hwnd)
        baseline = reader.titles(int(header["hwnd"]))
        if len(baseline) < 10:
            raise RuntimeError(f"unexpectedly short column set: {baseline!r}")

        sizes = [(1650, 930), (1120, 720), (1450, 820), (1000, 680), (1920, 1000)]
        for step in range(240):
            width, height = sizes[step % len(sizes)]
            if not gate.user32.MoveWindow(main_hwnd, 0, 0, width, height, True):
                raise ctypes.WinError(ctypes.get_last_error())
            gate.user32.SendMessageW(main_hwnd, WM_COMMAND, IDC_TAB_IMAGE if step % 2 else IDC_TAB_VIDEO, 0)
            time.sleep(0.02)
            current_header = header_handle(main_hwnd)
            current = reader.titles(int(current_header["hwnd"]))
            if current != baseline:
                raise RuntimeError(f"header captions changed at step {step}: {current!r}, baseline={baseline!r}")

        time.sleep(0.8)
        hashes: list[str] = []
        for frame in range(40):
            current_header = header_handle(main_hwnd)
            hashes.append(capture_header(current_header, evidence / f"header-stable-{frame:02d}.png" if frame in (0, 39) else None))
            if reader.titles(int(current_header["hwnd"])) != baseline:
                raise RuntimeError(f"header captions changed during stable frame {frame}")
            time.sleep(0.05)
        unique = list(dict.fromkeys(hashes))
        if len(unique) != 1:
            raise RuntimeError(f"header pixels are unstable: {len(unique)} unique hashes")

        report = {
            "iterations": 240,
            "column_count": len(baseline),
            "captions": baseline,
            "empty_caption_count": 0,
            "stable_frames": 40,
            "stable_unique_hashes": 1,
            "stable_hash": unique[0],
        }
        (evidence / "header-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=True, separators=(",", ":")))
        return 0
    finally:
        if reader is not None:
            reader.close()
        if process.poll() is None:
            process.kill()
        process.wait(timeout=10)
        shutil.rmtree(isolated, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
