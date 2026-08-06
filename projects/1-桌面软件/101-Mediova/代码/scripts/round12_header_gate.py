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


class HDITEMW(ctypes.Structure):
    # Win64 commctrl HDITEMW. Pointer fields intentionally use c_void_p so
    # ctypes preserves the native 8-byte alignment and does not try to marshal
    # the caller-owned UTF-16 buffer as a Python string value.
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


def header_handle(main_hwnd: int) -> dict[str, object]:
    headers = [child for child in gate.enumerate_children(main_hwnd) if child["class"] == "SysHeader32"]
    if len(headers) != 1:
        raise RuntimeError(f"expected exactly one header, got {headers!r}")
    return headers[0]


def header_titles(hwnd: int) -> list[str]:
    count = int(gate.user32.SendMessageW(hwnd, HDM_GETITEMCOUNT, 0, 0))
    if count < 1:
        raise RuntimeError(f"invalid header item count: {count}")
    values: list[str] = []
    for index in range(count):
        buffer = ctypes.create_unicode_buffer(256)
        item = HDITEMW()
        item.mask = HDI_TEXT
        item.pszText = ctypes.addressof(buffer)
        item.cchTextMax = len(buffer)
        result = gate.user32.SendMessageW(hwnd, HDM_GETITEMW, index, ctypes.addressof(item))
        if result == 0:
            raise RuntimeError(
                f"HDM_GETITEMW failed for column {index}; sizeof(HDITEMW)={ctypes.sizeof(HDITEMW)}"
            )
        text = buffer.value.strip()
        if not text:
            raise RuntimeError(f"empty header caption at column {index}")
        values.append(text)
    return values


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
    report: dict[str, object] = {}
    try:
        main_hwnd = gate.find_window(process.pid, "Mediova", 20.0)
        time.sleep(1.0)
        header = header_handle(main_hwnd)
        baseline = header_titles(int(header["hwnd"]))
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
            current = header_titles(int(current_header["hwnd"]))
            if current != baseline:
                raise RuntimeError(f"header captions changed at step {step}: {current!r}, baseline={baseline!r}")

        time.sleep(0.8)
        hashes: list[str] = []
        for frame in range(40):
            current_header = header_handle(main_hwnd)
            hashes.append(capture_header(current_header, evidence / f"header-stable-{frame:02d}.png" if frame in (0, 39) else None))
            if header_titles(int(current_header["hwnd"])) != baseline:
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
        if process.poll() is None:
            process.kill()
        process.wait(timeout=10)
        shutil.rmtree(isolated, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
