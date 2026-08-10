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
LVM_GETTOPINDEX = LVM_FIRST + 39
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_WHEEL = 0x0800
WHEEL_DELTA = 120
FORBIDDEN_SCROLL_CLASSES = {"MWRound9ScrollCover", "MWRound11StableScrollSurface"}
THUMB_LENGTH_TOLERANCE_PX = 2


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


def terminate_process(process: subprocess.Popen[bytes] | subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5.0)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5.0)


def list_child(main_hwnd: int) -> dict[str, object]:
    children = gate.enumerate_children(main_hwnd)
    lists = [child for child in children if child["class"] == "SysListView32"]
    if len(lists) != 1:
        raise RuntimeError(f"expected one ListView, got {lists!r}")
    forbidden = [child for child in children if child["class"] in FORBIDDEN_SCROLL_CLASSES]
    if forbidden:
        raise RuntimeError(f"retired scrollbar child windows exist: {forbidden!r}")
    runner.normal_list_geometry(main_hwnd)
    return lists[0]


def get_top_index(list_hwnd: int) -> int:
    return int(gate.user32.SendMessageW(list_hwnd, LVM_GETTOPINDEX, 0, 0))


def capture_list(main_hwnd: int, path: Path | None = None) -> Image.Image:
    image = runner.capture_screen_rect(runner.visible_list_rect(main_hwnd)).convert("RGB")
    if path is not None:
        image.save(path)
    return image


def horizontal_content_change(before: Image.Image, after: Image.Image) -> dict[str, object]:
    if before.size != after.size:
        raise RuntimeError(f"list size changed during horizontal drag: {before.size} -> {after.size}")
    width, height = before.size
    left = min(4, max(0, width - 1))
    top = min(30, max(0, height - 1))
    right = max(left + 1, width - 26)
    bottom = max(top + 1, height - 28)
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
    bbox_width = (bbox[2] - bbox[0]) if bbox else 0
    bbox_height = (bbox[3] - bbox[1]) if bbox else 0
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
        float(metrics["changed_ratio"]) >= 0.02
        and float(metrics["changed_bbox_width_ratio"]) >= 0.30
        and float(metrics["changed_bbox_height_ratio"]) >= 0.20
    )


def hover_thumb(main_hwnd: int, axis: str, evidence_path: Path) -> tuple[list[int], dict[str, object]]:
    left, top, right, bottom = runner.visible_list_rect(main_hwnd)
    if axis == "horizontal":
        x, y = (left + right) // 2, bottom - 9
    else:
        x, y = right - 9, top + max(60, (bottom - top) // 2)
    gate.user32.SetCursorPos(x, y)
    time.sleep(0.12)
    runner.normal_list_geometry(main_hwnd)
    image = capture_list(main_hwnd, evidence_path)
    try:
        metrics = overlay_gate.thumb_metrics(image, axis)
    finally:
        image.close()
    bbox = metrics.get("bbox")
    if not bbox or int(metrics.get("pixels", 0)) <= 0:
        raise RuntimeError(f"{axis} inline thumb not detected immediately: {metrics!r}")
    if axis == "horizontal" and int(metrics.get("height", 999)) > 10:
        raise RuntimeError(f"horizontal hover thumb became broad: {metrics!r}")
    if axis == "vertical" and int(metrics.get("width", 999)) > 10:
        raise RuntimeError(f"vertical hover thumb became broad: {metrics!r}")
    x1, y1, x2, y2 = [int(value) for value in bbox]
    return [left + x1, top + y1, left + x2, top + y2], metrics


def assert_drag_thumb_shape(axis: str, step: int, metrics: dict[str, object], reference: dict[str, object]) -> None:
    if int(metrics.get("pixels", 0)) <= 0 or not metrics.get("bbox"):
        raise RuntimeError(f"{axis} thumb vanished during drag step {step}: {metrics!r}")
    if axis == "horizontal":
        thickness = int(metrics.get("height", 999))
        length = int(metrics.get("width", 0))
        reference_thickness = int(reference.get("height", 999))
        reference_length = int(reference.get("width", 0))
    else:
        thickness = int(metrics.get("width", 999))
        length = int(metrics.get("height", 0))
        reference_thickness = int(reference.get("width", 999))
        reference_length = int(reference.get("height", 0))
    if thickness > 10 or abs(thickness - reference_thickness) > 1:
        raise RuntimeError(
            f"{axis} thumb thickness changed during drag step {step}: "
            f"reference={reference!r} current={metrics!r}"
        )
    if abs(length - reference_length) > THUMB_LENGTH_TOLERANCE_PX:
        raise RuntimeError(
            f"{axis} thumb length flickered during drag step {step}: "
            f"reference_length={reference_length} current_length={length} "
            f"reference={reference!r} current={metrics!r}"
        )


def drag_thumb(
    main_hwnd: int,
    axis: str,
    thumb: list[int],
    reference_metrics: dict[str, object],
    toward_end: bool,
    evidence: Path,
) -> list[dict[str, object]]:
    left, top, right, bottom = runner.visible_list_rect(main_hwnd)
    x1, y1, x2, y2 = thumb
    start_x = (x1 + x2) // 2
    start_y = (y1 + y2) // 2
    if axis == "horizontal":
        half = max(3, (x2 - x1) // 2)
        end_x = right - 28 - half if toward_end else left + 8 + half
        end_y = start_y
    else:
        half = max(3, (y2 - y1) // 2)
        end_x = start_x
        end_y = bottom - 28 - half if toward_end else top + 38 + half

    samples: list[dict[str, object]] = []
    runner.normal_list_geometry(main_hwnd)
    gate.user32.SetCursorPos(start_x, start_y)
    time.sleep(0.04)
    gate.user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    try:
        for step in range(1, 13):
            x = start_x + (end_x - start_x) * step // 12
            y = start_y + (end_y - start_y) * step // 12
            gate.user32.SetCursorPos(x, y)
            time.sleep(0.03)
            geometry = runner.normal_list_geometry(main_hwnd)
            frame = capture_list(
                main_hwnd,
                evidence / f"inline-{axis}-drag-{step:02d}.png",
            )
            try:
                metrics = overlay_gate.thumb_metrics(frame, axis)
            finally:
                frame.close()
            assert_drag_thumb_shape(axis, step, metrics, reference_metrics)
            samples.append({"step": step, "thumb": metrics, "geometry": geometry})
    finally:
        gate.user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    time.sleep(0.15)
    runner.normal_list_geometry(main_hwnd)
    return samples


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    args = parser.parse_args()

    exe = args.exe.resolve()
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    isolated = Path(tempfile.mkdtemp(prefix="mediova-round12-inline-function-"))
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
        child = list_child(main_hwnd)
        list_hwnd = int(child["hwnd"])
        initial_geometry = runner.normal_list_geometry(main_hwnd)

        runner.park_cursor(main_hwnd)
        before = capture_list(main_hwnd, evidence / "inline-function-horizontal-before.png")
        try:
            horizontal_thumb, horizontal_hover_metrics = hover_thumb(
                main_hwnd, "horizontal", evidence / "inline-function-horizontal-thumb.png"
            )
            horizontal_drag_samples = drag_thumb(
                main_hwnd,
                "horizontal",
                horizontal_thumb,
                horizontal_hover_metrics,
                True,
                evidence,
            )
            runner.park_cursor(main_hwnd)
            horizontal_after = capture_list(
                main_hwnd, evidence / "inline-function-horizontal-after.png"
            )
            try:
                horizontal_metrics = horizontal_content_change(before, horizontal_after)
            finally:
                horizontal_after.close()
        finally:
            before.close()
        horizontal_moved = horizontal_change_is_scroll(horizontal_metrics)
        if not horizontal_moved:
            raise RuntimeError(f"horizontal physical thumb drag did not move row content: {horizontal_metrics!r}")

        left, top, right, bottom = runner.visible_list_rect(main_hwnd)
        gate.user32.SetCursorPos((left + right) // 2, (top + bottom) // 2)
        wheel_before = get_top_index(list_hwnd)
        runner.normal_list_geometry(main_hwnd)
        gate.user32.mouse_event(
            MOUSEEVENTF_WHEEL,
            0,
            0,
            ctypes.c_uint32(-WHEEL_DELTA).value,
            0,
        )
        time.sleep(0.25)
        wheel_after = get_top_index(list_hwnd)
        wheel_geometry = runner.normal_list_geometry(main_hwnd)
        if wheel_after <= wheel_before:
            raise RuntimeError(f"mouse wheel did not move vertically: before={wheel_before} after={wheel_after}")

        vertical_before = get_top_index(list_hwnd)
        vertical_thumb, vertical_hover_metrics = hover_thumb(
            main_hwnd, "vertical", evidence / "inline-function-vertical-thumb.png"
        )
        vertical_drag_samples = drag_thumb(
            main_hwnd,
            "vertical",
            vertical_thumb,
            vertical_hover_metrics,
            True,
            evidence,
        )
        vertical_after = get_top_index(list_hwnd)
        if vertical_after <= vertical_before:
            raise RuntimeError(
                f"vertical physical thumb drag did not move rows: before={vertical_before} after={vertical_after}"
            )

        runner.park_cursor(main_hwnd)
        time.sleep(0.20)
        final_geometry = runner.normal_list_geometry(main_hwnd)

        report = {
            "architecture": "single-listview-inline-thumb",
            "overflow": overflow,
            "scrollbar_child_window_count": 0,
            "native_scroll_style_bits_throughout_interaction": 0,
            "thumb_length_stability_tolerance_px": THUMB_LENGTH_TOLERANCE_PX,
            "initial_geometry": initial_geometry,
            "horizontal_drag_content_moved": horizontal_moved,
            "horizontal_visual_change": horizontal_metrics,
            "horizontal_hover_thumb": horizontal_hover_metrics,
            "horizontal_drag_samples": horizontal_drag_samples,
            "mouse_wheel_vertical_moved": True,
            "wheel_top_before": wheel_before,
            "wheel_top_after": wheel_after,
            "wheel_geometry": wheel_geometry,
            "vertical_drag_content_moved": True,
            "vertical_top_before": vertical_before,
            "vertical_top_after": vertical_after,
            "vertical_hover_thumb": vertical_hover_metrics,
            "vertical_drag_samples": vertical_drag_samples,
            "final_geometry": final_geometry,
            "direct_listview_scroll_contract": "LVM_SCROLL",
        }
        (evidence / "round12-scroll-function-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(report, ensure_ascii=True, separators=(",", ":")))
        return 0
    finally:
        terminate_process(process)
        shutil.rmtree(isolated, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
