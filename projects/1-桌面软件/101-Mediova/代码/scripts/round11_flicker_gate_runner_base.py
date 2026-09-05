from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from ctypes import wintypes
from pathlib import Path
from typing import Any

from PIL import Image

import round11_flicker_gate as gate

LVM_FIRST = 0x1000
LVM_GETITEMCOUNT = LVM_FIRST + 4
LVM_GETCOLUMNWIDTH = LVM_FIRST + 29
LVM_SETCOLUMNWIDTH = LVM_FIRST + 30
LVM_GETCOUNTPERPAGE = LVM_FIRST + 40
WM_COMMAND = 0x0111
ROUND12_COLUMN_MENU_BASE = 2600
HDM_FIRST = 0x1200
HDM_GETITEMCOUNT = HDM_FIRST + 0
SRCCOPY = 0x00CC0020
ROUND11_SCROLL_PREVIEW_ARG = "--round11-scroll-preview"
INLINE_THUMB_COLORS = {(160, 171, 184), (110, 132, 158)}
IMMEDIATE_HOVER_SAMPLE_SECONDS = 0.10
FORBIDDEN_SCROLL_CLASSES = {
    "MWRound9ScrollCover",
    "MWRound11StableScrollSurface",
    "MWRound12ThumbVisual",
    "MWRound12FrozenNumber",
}
ROUND12_EXPANDED_COLUMN_WIDTHS = [
    44, 100, 230, 100, 76,
    66, 116, 58, 88, 92,
    140, 105, 124, 118, 92,
]


gate.user32.SendMessageW.argtypes = [
    wintypes.HWND,
    wintypes.UINT,
    wintypes.WPARAM,
    wintypes.LPARAM,
]
gate.user32.SendMessageW.restype = ctypes.c_ssize_t
gate.user32.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(gate.RECT)]
gate.user32.GetClientRect.restype = wintypes.BOOL
gate.gdi32.BitBlt.argtypes = [
    wintypes.HDC,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    wintypes.HDC,
    ctypes.c_int,
    ctypes.c_int,
    wintypes.DWORD,
]
gate.gdi32.BitBlt.restype = wintypes.BOOL


def capture_print_window_rect(rect: list[int]) -> Image.Image:
    """Capture a screen-relative child region through its smallest top-level owner.

    BitBlt of the desktop DC is unavailable in some locked/RDP automation
    sessions. PrintWindow remains supported there and also avoids unrelated
    foreground windows covering the application under test.
    """
    left, top, right, bottom = [int(value) for value in rect]
    candidates: list[tuple[int, int, gate.RECT]] = []

    @gate.WNDENUMPROC
    def callback(hwnd: int, _lparam: int) -> bool:
        if not gate.user32.IsWindowVisible(hwnd):
            return True
        owner = gate.RECT()
        if not gate.user32.GetWindowRect(hwnd, ctypes.byref(owner)):
            return True
        if owner.left <= left and owner.top <= top and owner.right >= right and owner.bottom >= bottom:
            area = max(1, owner.right - owner.left) * max(1, owner.bottom - owner.top)
            candidates.append((area, int(hwnd), owner))
        return True

    gate.user32.EnumWindows(callback, 0)
    if not candidates:
        raise RuntimeError(f"no visible top-level owner contains screen region {rect!r}")
    _, hwnd, owner = min(candidates, key=lambda item: item[0])
    whole = gate.capture_window(hwnd)
    try:
        crop = (left - owner.left, top - owner.top, right - owner.left, bottom - owner.top)
        return whole.crop(crop)
    finally:
        whole.close()


def capture_screen_rect(rect: list[int]) -> Image.Image:
    left, top, right, bottom = [int(value) for value in rect]
    width = right - left
    height = bottom - top
    if width < 1 or height < 1:
        raise RuntimeError(f"invalid screen region: {width}x{height}")

    screen_dc = gate.user32.GetDC(0)
    memory_dc = gate.gdi32.CreateCompatibleDC(screen_dc)
    bitmap = gate.gdi32.CreateCompatibleBitmap(screen_dc, width, height)
    old = gate.gdi32.SelectObject(memory_dc, bitmap)
    try:
        if not gate.gdi32.BitBlt(memory_dc, 0, 0, width, height, screen_dc, left, top, SRCCOPY):
            return capture_print_window_rect(rect)
        info = gate.BITMAPINFO()
        info.bmiHeader.biSize = ctypes.sizeof(gate.BITMAPINFOHEADER)
        info.bmiHeader.biWidth = width
        info.bmiHeader.biHeight = -height
        info.bmiHeader.biPlanes = 1
        info.bmiHeader.biBitCount = 32
        info.bmiHeader.biCompression = gate.BI_RGB
        buffer = ctypes.create_string_buffer(width * height * 4)
        rows = gate.gdi32.GetDIBits(
            memory_dc,
            bitmap,
            0,
            height,
            buffer,
            ctypes.byref(info),
            gate.DIB_RGB_COLORS,
        )
        if rows != height:
            raise RuntimeError(f"GetDIBits rows={rows}, want={height}")
        return gate.Image.frombuffer(
            "RGBA", (width, height), buffer.raw, "raw", "BGRA", 0, 1
        ).copy()
    finally:
        gate.gdi32.SelectObject(memory_dc, old)
        gate.gdi32.DeleteObject(bitmap)
        gate.gdi32.DeleteDC(memory_dc)
        gate.user32.ReleaseDC(0, screen_dc)


def list_handles(main_hwnd: int) -> tuple[int, int]:
    children = gate.enumerate_children(main_hwnd)
    listviews = [child for child in children if child["class"] == "SysListView32"]
    headers = [child for child in children if child["class"] == "SysHeader32"]
    if len(listviews) != 1 or len(headers) != 1:
        raise RuntimeError(f"expected one ListView/header, got {listviews!r} / {headers!r}")
    return int(listviews[0]["hwnd"]), int(headers[0]["hwnd"])


def list_child(main_hwnd: int) -> dict[str, Any]:
    list_hwnd, _ = list_handles(main_hwnd)
    return next(
        child
        for child in gate.enumerate_children(main_hwnd)
        if int(child["hwnd"]) == list_hwnd
    )


def assert_no_scroll_child_windows(main_hwnd: int) -> None:
    forbidden = [
        child
        for child in gate.enumerate_children(main_hwnd)
        if child["class"] in FORBIDDEN_SCROLL_CLASSES
    ]
    if forbidden:
        raise RuntimeError(f"retired scrollbar child windows still exist: {forbidden!r}")


def normal_list_geometry(main_hwnd: int) -> dict[str, Any]:
    child = list_child(main_hwnd)
    list_hwnd = int(child["hwnd"])
    rect = [int(value) for value in child["rect"]]
    client = gate.RECT()
    if not gate.user32.GetClientRect(list_hwnd, ctypes.byref(client)):
        raise ctypes.WinError(ctypes.get_last_error())
    style = int(str(child["style"]), 16)
    exstyle = int(str(child["exstyle"]), 16)
    scroll_bits = style & (gate.WS_HSCROLL | gate.WS_VSCROLL)
    assert_no_scroll_child_windows(main_hwnd)
    return {
        "hwnd": list_hwnd,
        "rect": rect,
        "size": [rect[2] - rect[0], rect[3] - rect[1]],
        "client_size": [int(client.right - client.left), int(client.bottom - client.top)],
        "style": style,
        "exstyle": exstyle,
        "native_scroll_style_bits": scroll_bits,
        "scroll_child_window_count": 0,
    }


def visible_list_rect(main_hwnd: int) -> list[int]:
    return list(normal_list_geometry(main_hwnd)["rect"])


def list_overflow_state(main_hwnd: int) -> dict[str, int | bool]:
    list_hwnd, header_hwnd = list_handles(main_hwnd)
    item_count = int(gate.user32.SendMessageW(list_hwnd, LVM_GETITEMCOUNT, 0, 0))
    per_page = int(gate.user32.SendMessageW(list_hwnd, LVM_GETCOUNTPERPAGE, 0, 0))
    column_count = int(gate.user32.SendMessageW(header_hwnd, HDM_GETITEMCOUNT, 0, 0))
    total_width = sum(
        int(gate.user32.SendMessageW(list_hwnd, LVM_GETCOLUMNWIDTH, index, 0))
        for index in range(max(0, column_count))
    )
    client = gate.RECT()
    if not gate.user32.GetClientRect(list_hwnd, ctypes.byref(client)):
        raise ctypes.WinError(ctypes.get_last_error())
    client_width = int(client.right - client.left)
    return {
        "item_count": item_count,
        "per_page": per_page,
        "column_count": column_count,
        "total_width": total_width,
        "client_width": client_width,
        "vertical": item_count > 0 and per_page > 0 and item_count > per_page,
        "horizontal": total_width > client_width,
    }


def establish_real_overflow(main_hwnd: int) -> dict[str, Any]:
    if not gate.user32.MoveWindow(main_hwnd, 0, 0, 1120, 520, True):
        raise ctypes.WinError(ctypes.get_last_error())
    deadline = time.monotonic() + 10.0
    state: dict[str, int | bool] = {}
    compact_state: dict[str, int | bool] | None = None
    while time.monotonic() < deadline:
        state = list_overflow_state(main_hwnd)
        if int(state["item_count"]) >= 35 and bool(state["vertical"]):
            compact_state = dict(state)
            if bool(compact_state["horizontal"]):
                raise RuntimeError(
                    f"compact default unexpectedly overflowed horizontally: {compact_state!r}"
                )
            list_hwnd, _ = list_handles(main_hwnd)
            for index, width in enumerate(ROUND12_EXPANDED_COLUMN_WIDTHS):
                # Expand through the same column-selection command a user
                # invokes. Directly assigning a hidden column a nonzero width
                # is intentionally rejected by the application, because that
                # was the unchecked-column Header drag bug.
                if int(gate.user32.SendMessageW(list_hwnd, LVM_GETCOLUMNWIDTH, index, 0)) == 0:
                    gate.user32.SendMessageW(
                        main_hwnd, WM_COMMAND, ROUND12_COLUMN_MENU_BASE + index, 0
                    )
                gate.user32.SendMessageW(list_hwnd, LVM_SETCOLUMNWIDTH, index, width)
            break
        time.sleep(0.10)

    if compact_state is None:
        raise RuntimeError(f"test-only real task mode did not produce vertical overflow: {state!r}")

    while time.monotonic() < deadline:
        state = list_overflow_state(main_hwnd)
        if bool(state["vertical"]) and bool(state["horizontal"]):
            time.sleep(0.5)
            normal_list_geometry(main_hwnd)
            result: dict[str, Any] = dict(list_overflow_state(main_hwnd))
            result["compact_default_total_width"] = compact_state["total_width"]
            result["compact_default_client_width"] = compact_state["client_width"]
            result["compact_default_horizontal"] = compact_state["horizontal"]
            result["expanded_for_user_selected_columns"] = True
            return result
        time.sleep(0.10)
    raise RuntimeError(f"user-selected columns did not produce two-axis overflow: {state!r}")


def thumb_pixels(image: Image.Image) -> tuple[int, tuple[int, int, int, int] | None]:
    rgb = image.convert("RGB")
    try:
        points: list[tuple[int, int]] = []
        for y in range(rgb.height):
            for x in range(rgb.width):
                if rgb.getpixel((x, y)) in INLINE_THUMB_COLORS:
                    points.append((x, y))
        if not points:
            return 0, None
        xs = [point[0] for point in points]
        ys = [point[1] for point in points]
        return len(points), (min(xs), min(ys), max(xs) + 1, max(ys) + 1)
    finally:
        rgb.close()


def list_state(main_hwnd: int, save_path: Path | None = None) -> tuple[str, int, tuple[int, int, int, int] | None]:
    image = capture_screen_rect(visible_list_rect(main_hwnd))
    try:
        if save_path is not None:
            image.save(save_path)
        digest = hashlib.sha256(image.tobytes()).hexdigest()
        count, bbox = thumb_pixels(image)
        return digest, count, bbox
    finally:
        image.close()


def inline_hover_point(main_hwnd: int, axis: str) -> tuple[int, int]:
    left, top, right, bottom = visible_list_rect(main_hwnd)
    if axis == "horizontal":
        return (left + right) // 2, bottom - 9
    return right - 9, top + max(60, (bottom - top) // 2)


def park_cursor(main_hwnd: int) -> None:
    rect = gate.RECT()
    if not gate.user32.GetWindowRect(main_hwnd, ctypes.byref(rect)):
        raise ctypes.WinError(ctypes.get_last_error())
    gate.user32.SetCursorPos(int(rect.left) + 12, int(rect.top) + 42)
    time.sleep(0.20)


def direct_surface_hover(
    hwnd: int,
    _surfaces: list[dict[str, object]],
    evidence: Path,
) -> list[dict[str, object]]:
    overflow = establish_real_overflow(hwnd)
    geometry = normal_list_geometry(hwnd)
    park_cursor(hwnd)

    records: list[dict[str, object]] = []
    for axis in ("horizontal", "vertical"):
        baseline_hash, baseline_pixels, _ = list_state(
            hwnd, evidence / f"inline-{axis}-baseline-hidden.png"
        )
        if baseline_pixels != 0:
            raise RuntimeError(f"{axis} thumb visible before edge hover: {baseline_pixels}")

        x, y = inline_hover_point(hwnd, axis)
        gate.user32.SetCursorPos(x, y)
        time.sleep(IMMEDIATE_HOVER_SAMPLE_SECONDS)
        visible_hash, visible_pixels, visible_bbox = list_state(
            hwnd, evidence / f"inline-{axis}-immediate-visible.png"
        )
        if visible_pixels <= 0 or visible_hash == baseline_hash or visible_bbox is None:
            raise RuntimeError(f"{axis} inline thumb did not appear immediately")

        hashes = [visible_hash]
        counts = [visible_pixels]
        for _ in range(19):
            time.sleep(0.05)
            digest, count, _ = list_state(hwnd)
            hashes.append(digest)
            counts.append(count)
        if len(set(hashes)) != 1 or min(counts) <= 0:
            raise RuntimeError(f"{axis} inline thumb flickered while hovered")

        park_cursor(hwnd)
        hidden_hash, hidden_pixels, _ = list_state(
            hwnd, evidence / f"inline-{axis}-left-hidden.png"
        )
        if hidden_pixels != 0 or hidden_hash != baseline_hash:
            raise RuntimeError(f"{axis} inline thumb did not disappear cleanly")

        records.append(
            {
                "axis": axis,
                "overflow": overflow,
                "scroll_child_window_count": 0,
                "visible_after_enter_ms": int(IMMEDIATE_HOVER_SAMPLE_SECONDS * 1000),
                "visible_thumb_pixels": visible_pixels,
                "visible_thumb_bbox": list(visible_bbox),
                "hover_frames": 20,
                "hover_unique_hashes": 1,
                "hidden_after_leave": True,
                "native_scroll_style_bits": 0,
                "list_geometry": geometry,
            }
        )
    return records


def run_window_probe_with_real_scroll_tasks(
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
    test_hover: bool = False,
):
    launch_args = list(args)
    if test_hover and ROUND11_SCROLL_PREVIEW_ARG not in launch_args:
        launch_args.append(ROUND11_SCROLL_PREVIEW_ARG)
    process = subprocess.Popen([str(exe), *launch_args], cwd=str(exe.parent), env=env)
    try:
        hwnd = gate.find_window(process.pid, title_prefix, 20.0)
        records = gate.check_regions(
            hwnd, window_name, width, height, settle_seconds, regions, evidence
        )
        children = gate.enumerate_children(hwnd)
        hover = direct_surface_hover(hwnd, children, evidence) if test_hover else []
        children = gate.enumerate_children(hwnd)
        return records, children, hover
    finally:
        if process.poll() is None:
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

    isolated = Path(tempfile.mkdtemp(prefix="mediova-round11-inline-scroll-"))
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

    report: dict[str, Any] = {"records": [], "hover": [], "windows": {}}
    try:
        records, children, hover = run_window_probe_with_real_scroll_tasks(
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
            test_hover=True,
        )
        report["records"].extend(records)
        report["hover"].extend(hover)
        report["windows"]["main"] = {
            "children": children,
            "listviews": [c for c in children if c["class"] == "SysListView32"],
            "scroll_child_windows": [c for c in children if c["class"] in FORBIDDEN_SCROLL_CLASSES],
        }

        records, children, _ = run_window_probe_with_real_scroll_tasks(
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

    unstable = [
        f"{record['window']}/{record['region']}={record['unique_hashes']}"
        for record in report["records"]
        if record["unique_hashes"] != 1
    ]
    if unstable:
        raise RuntimeError("unstable regions: " + "; ".join(unstable))

    listviews = report["windows"]["main"]["listviews"]
    if len(listviews) != 1:
        raise RuntimeError(f"expected exactly one ListView, got {len(listviews)}")
    style = int(listviews[0]["style"], 16)
    exstyle = int(listviews[0]["exstyle"], 16)
    if not style & gate.WS_HSCROLL:
        raise RuntimeError(
            f"native horizontal ListView scrollbar is missing: style=0x{style:08x}, exstyle=0x{exstyle:08x}"
        )

    scroll_children = report["windows"]["main"]["scroll_child_windows"]
    if scroll_children:
        raise RuntimeError(f"scrollbar child windows remain: {scroll_children!r}")
    if len(report["hover"]) != 2:
        raise RuntimeError(f"horizontal/vertical native scrollbar checks missing: {report['hover']!r}")

    print(json.dumps(report, ensure_ascii=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
