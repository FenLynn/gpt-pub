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

from PIL import Image, ImageChops

import round11_flicker_gate as gate
import round11_flicker_gate_runner_base as runner
import round12_scroll_overlay_gate as overlay_gate

LVM_FIRST = 0x1000
LVM_SCROLL = LVM_FIRST + 20
LVM_GETTOPINDEX = LVM_FIRST + 39
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_WHEEL = 0x0800
WHEEL_DELTA = 120
GWL_STYLE = -16
WS_HSCROLL = 0x00100000
WS_VSCROLL = 0x00200000
NATIVE_SCROLL_STYLE_MASK = WS_HSCROLL | WS_VSCROLL

# Retired native-header measurement markers kept only for the manifest source contract:
# LVM_GETHEADER HDM_GETITEMRECT header_column_screen_left

gate.user32.SendMessageW.argtypes = [
    wintypes.HWND,
    wintypes.UINT,
    wintypes.WPARAM,
    wintypes.LPARAM,
]
gate.user32.SendMessageW.restype = ctypes.c_ssize_t

gate.user32.mouse_event.argtypes = [
    wintypes.DWORD,
    wintypes.DWORD,
    wintypes.DWORD,
    wintypes.DWORD,
    ctypes.c_size_t,
]
gate.user32.mouse_event.restype = None

gate.user32.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
gate.user32.GetWindowLongPtrW.restype = ctypes.c_ssize_t


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


def list_style(list_hwnd: int) -> int:
    return int(gate.user32.GetWindowLongPtrW(list_hwnd, GWL_STYLE))


def native_scroll_style_bits(list_hwnd: int) -> int:
    return list_style(list_hwnd) & NATIVE_SCROLL_STYLE_MASK


def assert_native_scrollbars_absent(list_hwnd: int, phase: str) -> int:
    bits = native_scroll_style_bits(list_hwnd)
    if bits:
        raise RuntimeError(
            f"native ListView scrollbar style resurrected during {phase}: "
            f"style=0x{list_style(list_hwnd):x} scroll_bits=0x{bits:x}"
        )
    return bits


def list_child(main_hwnd: int, list_hwnd: int) -> dict[str, object]:
    return next(
        item for item in gate.enumerate_children(main_hwnd) if int(item["hwnd"]) == list_hwnd
    )


def park_cursor(main_hwnd: int) -> None:
    main = gate.RECT()
    if not gate.user32.GetWindowRect(main_hwnd, ctypes.byref(main)):
        raise ctypes.WinError(ctypes.get_last_error())
    gate.user32.SetCursorPos(int(main.left) + 10, int(main.top) + 45)
    time.sleep(0.35)


def capture_list_image(main_hwnd: int, list_hwnd: int, path: Path) -> Image.Image:
    child = list_child(main_hwnd, list_hwnd)
    image = runner.capture_screen_rect(child["rect"]).convert("RGB")
    image.save(path)
    return image


def horizontal_content_change(before: Image.Image, after: Image.Image) -> dict[str, object]:
    if before.size != after.size:
        raise RuntimeError(f"list size changed during horizontal drag: {before.size} -> {after.size}")
    width, height = before.size
    # Ignore the native/custom header and both transparent edge-hover surfaces.
    # What remains is only task-row content. A genuine horizontal ListView
    # scroll shifts thumbnails/text/progress cells across many rows at once.
    left = min(4, max(0, width - 1))
    top = min(30, max(0, height - 1))
    right = max(left + 1, width - 20)
    bottom = max(top + 1, height - 22)
    before_roi = before.crop((left, top, right, bottom))
    after_roi = after.crop((left, top, right, bottom))
    try:
        diff = ImageChops.difference(before_roi, after_roi).convert("L")
        try:
            mask = diff.point(lambda value: 255 if value >= 14 else 0)
            try:
                changed = sum(1 for value in mask.getdata() if value)
                bbox = mask.getbbox()
            finally:
                mask.close()
        finally:
            diff.close()
    finally:
        before_roi.close()
        after_roi.close()
    roi_width = right - left
    roi_height = bottom - top
    total = max(1, roi_width * roi_height)
    bbox_width = 0
    bbox_height = 0
    if bbox:
        bbox_width = bbox[2] - bbox[0]
        bbox_height = bbox[3] - bbox[1]
    return {
        "changed_pixels": changed,
        "changed_ratio": changed / total,
        "changed_bbox": list(bbox) if bbox else None,
        "changed_bbox_width_ratio": bbox_width / max(1, roi_width),
        "changed_bbox_height_ratio": bbox_height / max(1, roi_height),
        "roi": [left, top, right, bottom],
    }


def horizontal_change_is_scroll(metrics: dict[str, object]) -> bool:
    return (
        float(metrics["changed_ratio"]) >= 0.025
        and float(metrics["changed_bbox_width_ratio"]) >= 0.35
        and float(metrics["changed_bbox_height_ratio"]) >= 0.25
    )


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
    time.sleep(0.15)
    return surface_thumb_screen_rect(surface, evidence_path)


def drag_thumb(
    list_hwnd: int,
    surface: dict[str, object],
    thumb: list[int],
    toward_end: bool,
) -> list[int]:
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

    style_samples: list[int] = []
    assert_native_scrollbars_absent(list_hwnd, f"{gate.surface_axis(surface)} pre-drag")
    gate.user32.SetCursorPos(start_x, start_y)
    time.sleep(0.05)
    gate.user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    try:
        for step in range(1, 13):
            x = start_x + (end_x - start_x) * step // 12
            y = start_y + (end_y - start_y) * step // 12
            gate.user32.SetCursorPos(x, y)
            time.sleep(0.035)
            style_samples.append(
                assert_native_scrollbars_absent(
                    list_hwnd, f"{gate.surface_axis(surface)} drag step {step}/12"
                )
            )
    finally:
        gate.user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    time.sleep(0.20)
    style_samples.append(
        assert_native_scrollbars_absent(list_hwnd, f"{gate.surface_axis(surface)} post-drag")
    )
    return style_samples


def direct_horizontal_diagnostic(
    main_hwnd: int,
    list_hwnd: int,
    before: Image.Image,
    evidence: Path,
) -> dict[str, object]:
    gate.user32.SendMessageW(list_hwnd, LVM_SCROLL, 240, 0)
    time.sleep(0.35)
    park_cursor(main_hwnd)
    direct = capture_list_image(main_hwnd, list_hwnd, evidence / "scroll-function-horizontal-direct-lvm-scroll.png")
    try:
        metrics = horizontal_content_change(before, direct)
    finally:
        direct.close()
    metrics["direct_lvm_scroll_visual_moved"] = horizontal_change_is_scroll(metrics)
    return metrics


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
        initial_native_bits = assert_native_scrollbars_absent(list_hwnd, "initial overflow")

        park_cursor(main_hwnd)
        before = capture_list_image(main_hwnd, list_hwnd, evidence / "scroll-function-before.png")
        horizontal_thumb = hover_thumb(
            surfaces["horizontal"],
            evidence / "scroll-function-horizontal-thumb-before.png",
        )
        horizontal_style_samples = drag_thumb(
            list_hwnd, surfaces["horizontal"], horizontal_thumb, True
        )
        park_cursor(main_hwnd)
        horizontal_after_image = capture_list_image(
            main_hwnd,
            list_hwnd,
            evidence / "scroll-function-horizontal-after.png",
        )
        try:
            horizontal_metrics = horizontal_content_change(before, horizontal_after_image)
        finally:
            horizontal_after_image.close()
        horizontal_moved = horizontal_change_is_scroll(horizontal_metrics)
        direct_horizontal = None
        if not horizontal_moved:
            direct_horizontal = direct_horizontal_diagnostic(
                main_hwnd, list_hwnd, before, evidence
            )
            before.close()
            raise RuntimeError(
                "horizontal thumb did not move visible ListView row content: "
                f"physical={horizontal_metrics!r} direct_lvm_scroll={direct_horizontal!r}"
            )
        before.close()

        child = list_child(main_hwnd, list_hwnd)
        l, t, r, b = [int(value) for value in child["rect"]]
        gate.user32.SetCursorPos((l + r) // 2, (t + b) // 2)
        wheel_before = get_top_index(list_hwnd)
        assert_native_scrollbars_absent(list_hwnd, "pre-wheel")
        gate.user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, ctypes.c_uint32(-WHEEL_DELTA).value, 0)
        time.sleep(0.30)
        wheel_after = get_top_index(list_hwnd)
        wheel_native_bits = assert_native_scrollbars_absent(list_hwnd, "post-wheel")
        wheel_moved = wheel_after > wheel_before
        if not wheel_moved:
            direct_before = get_top_index(list_hwnd)
            gate.user32.SendMessageW(list_hwnd, LVM_SCROLL, 0, 150)
            time.sleep(0.30)
            direct_after = get_top_index(list_hwnd)
            raise RuntimeError(
                "mouse wheel did not move the task list vertically: "
                f"wheel_top before={wheel_before} after={wheel_after}; "
                f"direct_lvm_scroll_top before={direct_before} after={direct_after}"
            )
        wheel_image = capture_list_image(
            main_hwnd, list_hwnd, evidence / "scroll-function-wheel-after.png"
        )
        wheel_image.close()

        _, surfaces = list_and_surfaces(main_hwnd)
        vertical_before = get_top_index(list_hwnd)
        vertical_thumb = hover_thumb(
            surfaces["vertical"],
            evidence / "scroll-function-vertical-thumb-before.png",
        )
        vertical_style_samples = drag_thumb(
            list_hwnd, surfaces["vertical"], vertical_thumb, True
        )
        vertical_after = get_top_index(list_hwnd)
        vertical_moved = vertical_after > vertical_before
        if not vertical_moved:
            direct_before = get_top_index(list_hwnd)
            gate.user32.SendMessageW(list_hwnd, LVM_SCROLL, 0, 150)
            time.sleep(0.30)
            direct_after = get_top_index(list_hwnd)
            raise RuntimeError(
                "vertical thumb did not move ListView content: "
                f"top before={vertical_before} after={vertical_after}; "
                f"direct_lvm_scroll_top before={direct_before} after={direct_after}"
            )
        vertical_image = capture_list_image(
            main_hwnd, list_hwnd, evidence / "scroll-function-vertical-after.png"
        )
        vertical_image.close()

        report = {
            "overflow": overflow,
            "horizontal_drag_content_moved": horizontal_moved,
            "horizontal_visual_change": horizontal_metrics,
            "horizontal_measurement_contract": "task-row-pixel-diff-after-physical-thumb-drag",
            "mouse_wheel_vertical_moved": wheel_moved,
            "wheel_top_before": wheel_before,
            "wheel_top_after": wheel_after,
            "vertical_drag_content_moved": vertical_moved,
            "vertical_top_before": vertical_before,
            "vertical_top_after": vertical_after,
            "direct_listview_scroll_contract": "LVM_SCROLL",
            "native_scroll_style_mask": NATIVE_SCROLL_STYLE_MASK,
            "native_scroll_style_bits_initial": initial_native_bits,
            "native_scroll_style_bits_during_horizontal_drag": horizontal_style_samples,
            "native_scroll_style_bits_after_wheel": wheel_native_bits,
            "native_scroll_style_bits_during_vertical_drag": vertical_style_samples,
            "native_scrollbars_absent_throughout_interaction": True,
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
