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
from typing import Any

from PIL import Image


user32 = ctypes.WinDLL("user32", use_last_error=True)
gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wintypes.DWORD),
        ("biWidth", ctypes.c_long),
        ("biHeight", ctypes.c_long),
        ("biPlanes", wintypes.WORD),
        ("biBitCount", wintypes.WORD),
        ("biCompression", wintypes.DWORD),
        ("biSizeImage", wintypes.DWORD),
        ("biXPelsPerMeter", ctypes.c_long),
        ("biYPelsPerMeter", ctypes.c_long),
        ("biClrUsed", wintypes.DWORD),
        ("biClrImportant", wintypes.DWORD),
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wintypes.DWORD * 3)]


WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
PW_RENDERFULLCONTENT = 0x00000002
DIB_RGB_COLORS = 0
BI_RGB = 0
GWL_STYLE = -16
GWL_EXSTYLE = -20
WS_HSCROLL = 0x00100000
WS_VSCROLL = 0x00200000
WS_BORDER = 0x00800000
WS_EX_CLIENTEDGE = 0x00000200


user32.EnumWindows.argtypes = [WNDENUMPROC, wintypes.LPARAM]
user32.EnumWindows.restype = wintypes.BOOL
user32.EnumChildWindows.argtypes = [wintypes.HWND, WNDENUMPROC, wintypes.LPARAM]
user32.EnumChildWindows.restype = wintypes.BOOL
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.GetWindowThreadProcessId.restype = wintypes.DWORD
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetWindowTextW.restype = ctypes.c_int
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetClassNameW.restype = ctypes.c_int
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.IsWindowVisible.restype = wintypes.BOOL
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
user32.GetWindowRect.restype = wintypes.BOOL
user32.MoveWindow.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.BOOL]
user32.MoveWindow.restype = wintypes.BOOL
user32.PrintWindow.argtypes = [wintypes.HWND, wintypes.HDC, wintypes.UINT]
user32.PrintWindow.restype = wintypes.BOOL
user32.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
user32.SetCursorPos.restype = wintypes.BOOL
user32.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
user32.GetWindowLongW.restype = ctypes.c_long
user32.GetDC.argtypes = [wintypes.HWND]
user32.GetDC.restype = wintypes.HDC
user32.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
user32.ReleaseDC.restype = ctypes.c_int

gdi32.CreateCompatibleDC.argtypes = [wintypes.HDC]
gdi32.CreateCompatibleDC.restype = wintypes.HDC
gdi32.CreateCompatibleBitmap.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int]
gdi32.CreateCompatibleBitmap.restype = wintypes.HBITMAP
gdi32.SelectObject.argtypes = [wintypes.HDC, wintypes.HGDIOBJ]
gdi32.SelectObject.restype = wintypes.HGDIOBJ
gdi32.DeleteObject.argtypes = [wintypes.HGDIOBJ]
gdi32.DeleteObject.restype = wintypes.BOOL
gdi32.DeleteDC.argtypes = [wintypes.HDC]
gdi32.DeleteDC.restype = wintypes.BOOL
gdi32.GetDIBits.argtypes = [
    wintypes.HDC,
    wintypes.HBITMAP,
    wintypes.UINT,
    wintypes.UINT,
    wintypes.LPVOID,
    ctypes.POINTER(BITMAPINFO),
    wintypes.UINT,
]
gdi32.GetDIBits.restype = ctypes.c_int


def window_text(hwnd: int) -> str:
    buffer = ctypes.create_unicode_buffer(1024)
    user32.GetWindowTextW(hwnd, buffer, len(buffer))
    return buffer.value


def class_name(hwnd: int) -> str:
    buffer = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buffer, len(buffer))
    return buffer.value


def find_window(pid: int, title_prefix: str, timeout: float) -> int:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = 0

        @WNDENUMPROC
        def callback(hwnd: int, _lparam: int) -> bool:
            nonlocal result
            candidate = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(candidate))
            if candidate.value != pid or not user32.IsWindowVisible(hwnd):
                return True
            if window_text(hwnd).startswith(title_prefix):
                result = int(hwnd)
                return False
            return True

        user32.EnumWindows(callback, 0)
        if result:
            return result
        time.sleep(0.05)
    raise RuntimeError(f"window not found: {title_prefix!r}")


def enumerate_children(hwnd: int) -> list[dict[str, Any]]:
    children: list[dict[str, Any]] = []

    @WNDENUMPROC
    def callback(child: int, _lparam: int) -> bool:
        rect = RECT()
        user32.GetWindowRect(child, ctypes.byref(rect))
        style = ctypes.c_uint32(user32.GetWindowLongW(child, GWL_STYLE)).value
        exstyle = ctypes.c_uint32(user32.GetWindowLongW(child, GWL_EXSTYLE)).value
        children.append(
            {
                "hwnd": int(child),
                "class": class_name(child),
                "text": window_text(child),
                "visible": bool(user32.IsWindowVisible(child)),
                "style": f"0x{style:08x}",
                "exstyle": f"0x{exstyle:08x}",
                "rect": [rect.left, rect.top, rect.right, rect.bottom],
            }
        )
        return True

    user32.EnumChildWindows(hwnd, callback, 0)
    return children


def capture_window(hwnd: int) -> Image.Image:
    rect = RECT()
    if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        raise ctypes.WinError(ctypes.get_last_error())
    width = rect.right - rect.left
    height = rect.bottom - rect.top
    if width < 100 or height < 100:
        raise RuntimeError(f"invalid window size: {width}x{height}")

    screen_dc = user32.GetDC(0)
    memory_dc = gdi32.CreateCompatibleDC(screen_dc)
    bitmap = gdi32.CreateCompatibleBitmap(screen_dc, width, height)
    old = gdi32.SelectObject(memory_dc, bitmap)
    try:
        if not user32.PrintWindow(hwnd, memory_dc, PW_RENDERFULLCONTENT):
            raise ctypes.WinError(ctypes.get_last_error())
        info = BITMAPINFO()
        info.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        info.bmiHeader.biWidth = width
        info.bmiHeader.biHeight = -height
        info.bmiHeader.biPlanes = 1
        info.bmiHeader.biBitCount = 32
        info.bmiHeader.biCompression = BI_RGB
        buffer = ctypes.create_string_buffer(width * height * 4)
        rows = gdi32.GetDIBits(memory_dc, bitmap, 0, height, buffer, ctypes.byref(info), DIB_RGB_COLORS)
        if rows != height:
            raise RuntimeError(f"GetDIBits rows={rows}, want={height}")
        return Image.frombuffer("RGBA", (width, height), buffer.raw, "raw", "BGRA", 0, 1).copy()
    finally:
        gdi32.SelectObject(memory_dc, old)
        gdi32.DeleteObject(bitmap)
        gdi32.DeleteDC(memory_dc)
        user32.ReleaseDC(0, screen_dc)


def region_box(image: Image.Image, region: dict[str, Any]) -> tuple[int, int, int, int]:
    left = max(0, int(image.width * float(region["x"])))
    top = max(0, int(image.height * float(region["y"])))
    width = max(1, int(image.width * float(region["w"])))
    height = max(1, int(image.height * float(region["h"])))
    right = min(image.width, left + width)
    bottom = min(image.height, top + height)
    return left, top, right, bottom


def check_regions(
    hwnd: int,
    window_name: str,
    width: int,
    height: int,
    settle_seconds: float,
    regions: list[dict[str, Any]],
    evidence: Path,
) -> list[dict[str, Any]]:
    if not user32.MoveWindow(hwnd, 0, 0, width, height, True):
        raise ctypes.WinError(ctypes.get_last_error())
    user32.SetCursorPos(width // 2, height // 2)
    time.sleep(settle_seconds)

    hashes: dict[str, list[str]] = {r["name"]: [] for r in regions}
    seen: dict[str, dict[str, int]] = {r["name"]: {} for r in regions}
    for frame_index in range(40):
        frame = capture_window(hwnd)
        try:
            for region in regions:
                name = str(region["name"])
                crop = frame.crop(region_box(frame, region))
                digest = hashlib.sha256(crop.tobytes()).hexdigest()
                hashes[name].append(digest)
                if digest not in seen[name]:
                    unique_index = len(seen[name]) + 1
                    seen[name][digest] = frame_index
                    crop.save(evidence / f"{window_name}-{name}-unique-{unique_index}-frame-{frame_index}.png")
        finally:
            frame.close()
        time.sleep(0.05)

    records: list[dict[str, Any]] = []
    for region in regions:
        name = str(region["name"])
        unique = list(dict.fromkeys(hashes[name]))
        records.append(
            {
                "window": window_name,
                "region": name,
                "frames": 40,
                "unique_hashes": len(unique),
                "first_hash": hashes[name][0],
                "last_hash": hashes[name][-1],
                "representative_frames": seen[name],
            }
        )
    return records


def run_window_probe(
    exe: Path,
    args: list[str],
    title_prefix: str,
    window_name: str,
    width: int,
    height: int,
    settle_seconds: float,
    regions: list[dict[str, Any]],
    evidence: Path,
    env: dict[str, str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    process = subprocess.Popen([str(exe), *args], cwd=str(exe.parent), env=env)
    try:
        hwnd = find_window(process.pid, title_prefix, 20.0)
        records = check_regions(hwnd, window_name, width, height, settle_seconds, regions, evidence)
        children = enumerate_children(hwnd)
        return records, children
    finally:
        process.kill()
        process.wait(timeout=10)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    args = parser.parse_args()

    exe = args.exe.resolve()
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    if not exe.is_file():
        raise FileNotFoundError(exe)

    isolated = Path(tempfile.mkdtemp(prefix="mediova-round11-flicker-"))
    env = os.environ.copy()
    env["APPDATA"] = str(isolated)
    env["LOCALAPPDATA"] = str(isolated)

    main_regions = [
        {"name": "list-and-bars", "x": 0.00, "y": 0.13, "w": 0.84, "h": 0.70},
        {"name": "output-path", "x": 0.00, "y": 0.84, "w": 0.74, "h": 0.06},
    ]
    editor_regions = [
        {"name": "file-title", "x": 0.58, "y": 0.00, "w": 0.41, "h": 0.08},
        {"name": "timeline", "x": 0.00, "y": 0.54, "w": 0.62, "h": 0.27},
        {"name": "preview", "x": 0.00, "y": 0.04, "w": 0.62, "h": 0.50},
    ]

    report: dict[str, Any] = {"records": [], "windows": {}}
    try:
        records, children = run_window_probe(
            exe,
            ["--ui-preview=video"],
            "Mediova",
            "main-idle",
            1450,
            820,
            2.2,
            main_regions,
            evidence,
            env,
        )
        report["records"].extend(records)
        report["windows"]["main"] = {
            "children": children,
            "listviews": [c for c in children if c["class"] == "SysListView32"],
            "stable_surfaces": [c for c in children if c["class"] == "MWRound11StableScrollSurface"],
        }

        records, children = run_window_probe(
            exe,
            ["--round11-editor-preview"],
            "剪裁 · Round11-Flicker-Probe.mp4",
            "editor-idle",
            1080,
            760,
            3.2,
            editor_regions,
            evidence,
            env,
        )
        report["records"].extend(records)
        report["windows"]["editor"] = {"children": children}
    finally:
        shutil.rmtree(isolated, ignore_errors=True)

    report_path = evidence / "flicker-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    failures = [
        f"{record['window']}/{record['region']}={record['unique_hashes']}"
        for record in report["records"]
        if record["unique_hashes"] != 1
    ]
    if failures:
        raise RuntimeError("unstable regions: " + "; ".join(failures))

    listviews = report["windows"]["main"]["listviews"]
    if len(listviews) != 1:
        raise RuntimeError(f"expected exactly one ListView, got {len(listviews)}")
    style = int(listviews[0]["style"], 16)
    exstyle = int(listviews[0]["exstyle"], 16)
    forbidden_style = style & (WS_HSCROLL | WS_VSCROLL | WS_BORDER)
    forbidden_exstyle = exstyle & WS_EX_CLIENTEDGE
    if forbidden_style or forbidden_exstyle:
        raise RuntimeError(
            f"native ListView chrome remains: style=0x{style:08x}, exstyle=0x{exstyle:08x}"
        )

    surfaces = report["windows"]["main"]["stable_surfaces"]
    if len(surfaces) != 2 or not all(surface["visible"] for surface in surfaces):
        raise RuntimeError(f"stable surfaces invalid: {surfaces!r}")

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
