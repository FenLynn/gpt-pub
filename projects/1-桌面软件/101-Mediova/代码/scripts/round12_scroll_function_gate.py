from __future__ import annotations

import argparse
import ctypes
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
import round12_scroll_overlay_gate as overlay_gate

LVM_FIRST = 0x1000
LVM_GETTOPINDEX = LVM_FIRST + 39
LVM_GETSUBITEMRECT = LVM_FIRST + 56
LVIR_BOUNDS = 0
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_WHEEL = 0x0800
WHEEL_DELTA = 120

gate.user32.mouse_event.argtypes = [
    wintypes.DWORD,
    wintypes.DWORD,
    wintypes.DWORD,
    wintypes.DWORD,
    ctypes.c_size_t,
]
gate.user32.mouse_event.restype = None


def terminate_process(process: subprocess.Popen[bytes] | subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5.0)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5.0)


def list_and_surfaces(main_hwnd: int) -> tuple[int, dict[str, dict[str, object]]]:
    children = gate.enumerate_children(main_hwnd)
    lists = [child for child in children if child["class"] == "SysListView32"]
    surfaces = [
        child
        for child in children
        if child["class"] == "MWRound11StableScrollSurface" and child["visible"]
    ]
    if len(lists) != 1 or len(surfaces) != 2:
        raise RuntimeError(f"functional scroll HWND discovery failed: lists={lists!r} surfaces={surfaces!r}")
    by_axis = {gate.surface_axis(surface): surface for surface in surfaces}
    if set(by_axis) != {"horizontal", "vertical"}:
        raise RuntimeError(f"functional scroll surfaces missing axis: {by_axis!r}")
    return int(lists[0]["hwnd"]), by_axis


def get_top_index(list_hwnd: int) -> int:
    return int(gate.user32.SendMessageW(list_hwnd, LVM_GETTOPINDEX, 0, 0))


def subitem_left(list_hwnd: int, item: int = 0, subitem: int = 1) -> int:
    rect = gate.RECT()
    rect.top = subitem
    rect.left = LVIR_BOUNDS
    result = int(
        gate.user32.SendMessageW(
            list_hwnd,
            LVM_GETSUBITEMRECT,
            item,
            ctypes.addressof(rect),
        )
    )
    if result == 0:
        raise RuntimeError(f"LVM_GETSUBITEMRECT failed for item={item} subitem={subitem}")
    return int(rect.left)


def surface_thumb_screen_rect(surface: dict[str, object], evidence_path: Path) -> list[int]:
    image = runner.capture_screen_rect(surface["rect"])
    try:
        image.save(evidence_path)
        metrics = overlay_gate.thumb_metrics(image)
    finally:
        image.close()
    bbox = metrics.get("bbox")
    if not bbox:
        raise RuntimeError(f"visible functional thumb was not detected: {surface!r}")
    left, top, _, _ = [int(value) for value in surface["rect"]]
    x1, y1, x2, y2 = [int(value) for value in bbox]
    return [left + x1, top + y1, left + x2, top + y2]


def hover_thumb(surface: dict[str, object], evidence_path: Path) -> list[int]:
    left, top, right, bottom = [int(value) for value in surface["rect"]]
    gate.user32.SetCursorPos((left + right) // 2, (top + bottom) // 2)
    time.sleep(0.70)
    return surface_thumb_screen_rect(surface, evidence_path)


def drag_thumb(surface: dict[str, object], thumb: list[int], toward_end: bool) -> None:
    left, top, right, bottom = [int(value) for value in surface["rect"]]
    x1, y1, x2, y2 = thumb
    start_x = (x1 + x2) // 2
    start_y = (y1 + y2) // 2
    if gate.surface_axis(surface) == "horizontal":
        end_x = right - max(8, (x2 - x1) // 2 + 3) if toward_end else left + max(8, (x2 - x1) // 2 + 3)
        end_y = start_y
    else:
        end_x = start_x
        end_y = bottom - max(8, (y2 - y1) // 2 + 3) if toward_end else top + max(8, (y2 - y1) // 2 + 3)

    gate.user32.SetCursorPos(start_x, start_y)
    time.sleep(0.05)
    gate.user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    try:
        for step in range(1, 13):
            x = start_x + (end_x - start_x) * step // 12
            y = start_y + (end_y - start_y) * step // 12
            gate.user32.SetCursorPos(x, y)
            time.sleep(0.035)
    finally:
        gate.user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    time.sleep(0.45)


def capture_list(main_hwnd: int, list_hwnd: int, path: Path) -> None:
    child = next(
        item for item in gate.enumerate_children(main_hwnd) if int(item["hwnd"]) == list_hwnd
    )
    image = runner.capture_screen_rect(child["rect"])
    try:
        image.save(path)
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
    isolated = Path(tempfile.mkdtemp(prefix="mediova-round12-scroll-function-"))
    env = os.environ.copy()
    env["APPDATA"] = str(isolated)
    env["LOCALAPPDATA"] = str(isolated)
    env["XDG_CONFIG_HOME"] = str(isolated)

    process = subprocess.Popen(
        [str(exe), "--ui-preview=video", runner.ROUND11_SCROLL_PREVIEW_ARG],
        cwd=str(exe.parent),
        env=env,
    )
    try:
        main_hwnd = gate.find_window(process.pid, "Mediova", 20.0)
        overflow = runner.establish_real_overflow(main_hwnd)
        time.sleep(1.0)
        list_hwnd, surfaces = list_and_surfaces(main_hwnd)

        capture_list(main_hwnd, list_hwnd, evidence / "scroll-function-before.png")
        horizontal_before = subitem_left(list_hwnd)
        horizontal_thumb = hover_thumb(
            surfaces["horizontal"],
            evidence / "scroll-function-horizontal-thumb-before.png",
        )
        drag_thumb(surfaces["horizontal"], horizontal_thumb, True)
        horizontal_after = subitem_left(list_hwnd)
        capture_list(main_hwnd, list_hwnd, evidence / "scroll-function-horizontal-after.png")
        horizontal_moved = horizontal_after < horizontal_before - 50
        if not horizontal_moved:
            raise RuntimeError(
                "horizontal thumb moved without ListView content movement: "
                f"subitem_left before={horizontal_before} after={horizontal_after}"
            )

        list_child = next(
            item for item in gate.enumerate_children(main_hwnd) if int(item["hwnd"]) == list_hwnd
        )
        l, t, r, b = [int(value) for value in list_child["rect"]]
        gate.user32.SetCursorPos((l + r) // 2, (t + b) // 2)
        wheel_before = get_top_index(list_hwnd)
        gate.user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, ctypes.c_uint32(-WHEEL_DELTA).value, 0)
        time.sleep(0.45)
        wheel_after = get_top_index(list_hwnd)
        wheel_moved = wheel_after > wheel_before
        if not wheel_moved:
            raise RuntimeError(
                "mouse wheel did not move the task list vertically: "
                f"top before={wheel_before} after={wheel_after}"
            )
        capture_list(main_hwnd, list_hwnd, evidence / "scroll-function-wheel-after.png")

        # Refresh surface geometry because the wheel can invalidate/reposition the
        # transparent covers. Then prove the vertical thumb itself moves content.
        _, surfaces = list_and_surfaces(main_hwnd)
        vertical_before = get_top_index(list_hwnd)
        vertical_thumb = hover_thumb(
            surfaces["vertical"],
            evidence / "scroll-function-vertical-thumb-before.png",
        )
        drag_thumb(surfaces["vertical"], vertical_thumb, True)
        vertical_after = get_top_index(list_hwnd)
        vertical_moved = vertical_after > vertical_before
        if not vertical_moved:
            raise RuntimeError(
                "vertical thumb moved without ListView content movement: "
                f"top before={vertical_before} after={vertical_after}"
            )
        capture_list(main_hwnd, list_hwnd, evidence / "scroll-function-vertical-after.png")

        report = {
            "overflow": overflow,
            "horizontal_drag_content_moved": horizontal_moved,
            "horizontal_subitem_left_before": horizontal_before,
            "horizontal_subitem_left_after": horizontal_after,
            "mouse_wheel_vertical_moved": wheel_moved,
            "wheel_top_before": wheel_before,
            "wheel_top_after": wheel_after,
            "vertical_drag_content_moved": vertical_moved,
            "vertical_top_before": vertical_before,
            "vertical_top_after": vertical_after,
            "direct_listview_scroll_contract": "LVM_SCROLL",
        }
        (evidence / "round12-scroll-function-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
        return 0
    finally:
        terminate_process(process)
        shutil.rmtree(isolated, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
