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

THUMB_COLORS = {(160, 171, 184), (110, 132, 158)}
IDC_LIST = 1020
GWL_STYLE = -16
WS_HSCROLL = 0x00100000
WS_VSCROLL = 0x00200000
NORMAL_COMPACT_WIDTH = 1120
NORMAL_COMPACT_HEIGHT = 720
NATIVE_ARROW_DARK_RATIO_LIMIT = 0.08
NULLREGION = 1
SIMPLEREGION = 2
COMPLEXREGION = 3
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004


def changed_metrics(before: Image.Image, after: Image.Image) -> dict[str, object]:
    if before.size != after.size:
        raise RuntimeError(f"overlay evidence size changed: before={before.size} after={after.size}")
    diff = ImageChops.difference(before.convert("RGB"), after.convert("RGB"))
    try:
        mask = diff.convert("L").point(lambda value: 255 if value >= 12 else 0)
        try:
            bbox = mask.getbbox()
            changed = sum(1 for value in mask.getdata() if value)
        finally:
            mask.close()
    finally:
        diff.close()
    width, height = before.size
    total = max(1, width * height)
    return {
        "changed_pixels": changed,
        "changed_ratio": changed / total,
        "changed_bbox": list(bbox) if bbox else None,
        "surface_size": [width, height],
    }


def thumb_metrics(image: Image.Image) -> dict[str, object]:
    rgb = image.convert("RGB")
    try:
        coordinates: list[tuple[int, int]] = []
        pixels = rgb.load()
        for y in range(rgb.height):
            for x in range(rgb.width):
                if pixels[x, y] in THUMB_COLORS:
                    coordinates.append((x, y))
    finally:
        rgb.close()
    if not coordinates:
        return {"pixels": 0, "bbox": None, "coverage": 0.0}
    xs = [item[0] for item in coordinates]
    ys = [item[1] for item in coordinates]
    bbox = [min(xs), min(ys), max(xs) + 1, max(ys) + 1]
    area = max(1, (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]))
    return {
        "pixels": len(coordinates),
        "bbox": bbox,
        "coverage": len(coordinates) / area,
    }


def outside_thumb_change(
    before: Image.Image,
    after: Image.Image,
    thumb_bbox: list[int],
) -> dict[str, object]:
    if before.size != after.size:
        raise RuntimeError(f"overlay evidence size changed: before={before.size} after={after.size}")
    left, top, right, bottom = [int(value) for value in thumb_bbox]
    left -= 1
    top -= 1
    right += 1
    bottom += 1
    diff = ImageChops.difference(before.convert("RGB"), after.convert("RGB")).convert("L")
    try:
        changed = 0
        compared = 0
        max_changed_in_row = 0
        for y in range(after.height):
            row_changed = 0
            for x in range(after.width):
                if left <= x < right and top <= y < bottom:
                    continue
                compared += 1
                if diff.getpixel((x, y)) >= 12:
                    changed += 1
                    row_changed += 1
            max_changed_in_row = max(max_changed_in_row, row_changed)
    finally:
        diff.close()
    return {
        "changed_pixels": changed,
        "compared_pixels": compared,
        "changed_ratio": changed / max(1, compared),
        "max_changed_pixels_in_row": max_changed_in_row,
    }


def validate_transparent_track(
    axis: str,
    baseline: Image.Image,
    visible: Image.Image,
) -> dict[str, object]:
    thumb = thumb_metrics(visible)
    if int(thumb["pixels"]) <= 0 or not thumb["bbox"]:
        raise RuntimeError(f"{axis} visible overlay did not contain a thumb: {thumb!r}")
    if float(thumb["coverage"]) < 0.80:
        raise RuntimeError(f"{axis} thumb geometry was not a compact filled shape: {thumb!r}")

    outside = outside_thumb_change(baseline, visible, list(thumb["bbox"]))
    if float(outside["changed_ratio"]) > 0.02:
        raise RuntimeError(
            f"{axis} overlay changed pixels outside the thumb; track is not transparent: "
            f"thumb={thumb!r} outside={outside!r}"
        )
    return {"thumb": thumb, "outside_thumb_change": outside}


def dark_ratio(image: Image.Image) -> float:
    rgb = image.convert("RGB")
    try:
        pixels = list(rgb.getdata())
    finally:
        rgb.close()
    if not pixels:
        return 0.0
    dark = sum(1 for r, g, b in pixels if (77 * r + 150 * g + 29 * b) >> 8 < 150)
    return dark / len(pixels)


def terminate_process(process: subprocess.Popen[bytes] | subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5.0)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5.0)


def validate_normal_compact_surface(exe: Path, env: dict[str, str], evidence: Path) -> dict[str, object]:
    user32 = gate.user32
    user32.GetDlgItem.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.GetDlgItem.restype = wintypes.HWND
    get_window_long_ptr = user32.GetWindowLongPtrW
    get_window_long_ptr.argtypes = [wintypes.HWND, ctypes.c_int]
    get_window_long_ptr.restype = ctypes.c_ssize_t

    process = subprocess.Popen([str(exe), "--ui-preview=video"], cwd=str(exe.parent), env=env)
    try:
        main_hwnd = gate.find_window(process.pid, "Mediova", 20.0)
        if not user32.MoveWindow(main_hwnd, 0, 0, NORMAL_COMPACT_WIDTH, NORMAL_COMPACT_HEIGHT, True):
            raise ctypes.WinError(ctypes.get_last_error())
        time.sleep(1.5)
        list_hwnd = int(user32.GetDlgItem(main_hwnd, IDC_LIST))
        if not list_hwnd:
            raise RuntimeError("normal compact task list was not found")

        style = int(get_window_long_ptr(list_hwnd, GWL_STYLE))
        scroll_style_bits = style & (WS_HSCROLL | WS_VSCROLL)
        if scroll_style_bits:
            raise RuntimeError(
                f"normal compact ListView restored native scrollbar style bits: style=0x{style:x} "
                f"scroll_bits=0x{scroll_style_bits:x}"
            )

        list_info = next(
            child for child in gate.enumerate_children(main_hwnd) if int(child["hwnd"]) == list_hwnd
        )
        left, top, right, bottom = [int(value) for value in list_info["rect"]]
        strip_height = max(12, min(20, bottom - top))
        strip_rect = [left, bottom - strip_height, right, bottom]
        strip = runner.capture_screen_rect(strip_rect)
        try:
            strip.save(evidence / "normal-compact-list-bottom.png")
            corner = min(17, strip.width // 3)
            left_corner = strip.crop((0, 0, corner, strip.height))
            right_corner = strip.crop((max(0, strip.width - corner), 0, strip.width, strip.height))
            try:
                left_dark = dark_ratio(left_corner)
                right_dark = dark_ratio(right_corner)
            finally:
                left_corner.close()
                right_corner.close()
        finally:
            strip.close()

        if left_dark > NATIVE_ARROW_DARK_RATIO_LIMIT or right_dark > NATIVE_ARROW_DARK_RATIO_LIMIT:
            raise RuntimeError(
                "normal compact list bottom still resembles a native scrollbar arrow lane: "
                f"left_dark={left_dark:.4f} right_dark={right_dark:.4f} "
                f"limit={NATIVE_ARROW_DARK_RATIO_LIMIT:.4f}"
            )
        return {
            "window_size": [NORMAL_COMPACT_WIDTH, NORMAL_COMPACT_HEIGHT],
            "list_style": style,
            "native_scroll_style_bits": scroll_style_bits,
            "bottom_strip_rect": strip_rect,
            "left_corner_dark_ratio": left_dark,
            "right_corner_dark_ratio": right_dark,
            "native_arrow_dark_ratio_limit": NATIVE_ARROW_DARK_RATIO_LIMIT,
            "normal_compact_native_scrollbars_hidden": True,
        }
    finally:
        terminate_process(process)


def configure_region_api() -> tuple[ctypes.WinDLL, ctypes.WinDLL]:
    user32 = gate.user32
    gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
    user32.GetWindowRgn.argtypes = [wintypes.HWND, wintypes.HRGN]
    user32.GetWindowRgn.restype = ctypes.c_int
    gdi32.CreateRectRgn.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int]
    gdi32.CreateRectRgn.restype = wintypes.HRGN
    gdi32.GetRgnBox.argtypes = [wintypes.HRGN, ctypes.POINTER(wintypes.RECT)]
    gdi32.GetRgnBox.restype = ctypes.c_int
    gdi32.DeleteObject.argtypes = [wintypes.HGDIOBJ]
    gdi32.DeleteObject.restype = wintypes.BOOL
    user32.mouse_event.argtypes = [
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.c_size_t,
    ]
    user32.mouse_event.restype = None
    return user32, gdi32


def window_region_metrics(hwnd: int) -> dict[str, object]:
    user32, gdi32 = configure_region_api()
    region = gdi32.CreateRectRgn(0, 0, 0, 0)
    if not region:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        region_type = int(user32.GetWindowRgn(hwnd, region))
        box = wintypes.RECT()
        box_type = int(gdi32.GetRgnBox(region, ctypes.byref(box)))
        bbox = [int(box.left), int(box.top), int(box.right), int(box.bottom)]
        return {
            "region_type": region_type,
            "box_type": box_type,
            "bbox": bbox,
            "width": max(0, int(box.right - box.left)),
            "height": max(0, int(box.bottom - box.top)),
        }
    finally:
        gdi32.DeleteObject(region)


def require_hidden_region(axis: str, phase: str, metrics: dict[str, object]) -> None:
    if int(metrics["region_type"]) != NULLREGION or int(metrics["box_type"]) != NULLREGION:
        raise RuntimeError(f"{axis} {phase} region was not empty: {metrics!r}")
    if int(metrics["width"]) != 0 or int(metrics["height"]) != 0:
        raise RuntimeError(f"{axis} {phase} empty region retained area: {metrics!r}")


def require_thumb_only_region(
    axis: str,
    phase: str,
    surface: dict[str, object],
    metrics: dict[str, object],
) -> None:
    if int(metrics["region_type"]) not in (SIMPLEREGION, COMPLEXREGION):
        raise RuntimeError(f"{axis} {phase} region was not a real thumb region: {metrics!r}")
    left, top, right, bottom = [int(value) for value in surface["rect"]]
    full_width = max(1, right - left)
    full_height = max(1, bottom - top)
    cross = int(metrics["height"]) if axis == "horizontal" else int(metrics["width"])
    full_cross = full_height if axis == "horizontal" else full_width
    if cross <= 0 or cross >= full_cross:
        raise RuntimeError(
            f"{axis} {phase} region still spans the broad surface: cross={cross} "
            f"full_cross={full_cross} metrics={metrics!r}"
        )
    if cross > max(10, int(full_cross * 0.65)):
        raise RuntimeError(
            f"{axis} {phase} region is too thick for a single thumb: cross={cross} "
            f"full_cross={full_cross} metrics={metrics!r}"
        )


def validate_window_region_ownership(main_hwnd: int, evidence: Path) -> list[dict[str, object]]:
    runner.establish_real_overflow(main_hwnd)
    gate.user32.SetCursorPos(900, 40)
    time.sleep(0.35)
    children = gate.enumerate_children(main_hwnd)
    surfaces = [
        child
        for child in children
        if child["class"] == "MWRound11StableScrollSurface" and child["visible"]
    ]
    if len(surfaces) != 2:
        raise RuntimeError(f"region gate expected two stable surfaces, got {surfaces!r}")

    records: list[dict[str, object]] = []
    for surface in sorted(surfaces, key=gate.surface_axis):
        axis = gate.surface_axis(surface)
        hwnd = int(surface["hwnd"])
        left, top, right, bottom = [int(value) for value in surface["rect"]]

        hidden_before = window_region_metrics(hwnd)
        require_hidden_region(axis, "hidden-before", hidden_before)

        gate.user32.SetCursorPos((left + right) // 2, (top + bottom) // 2)
        time.sleep(0.12)
        visible = window_region_metrics(hwnd)
        require_thumb_only_region(axis, "hover-visible", surface, visible)

        hover_image = runner.capture_screen_rect(surface["rect"])
        try:
            hover_image.save(evidence / f"region-{axis}-hover-visible.png")
            hover_thumb = thumb_metrics(hover_image)
        finally:
            hover_image.close()
        if int(hover_thumb["pixels"]) <= 0:
            raise RuntimeError(f"{axis} region was visible but rendered thumb pixels were absent")

        bx1, by1, bx2, by2 = [int(value) for value in visible["bbox"]]
        start_x = left + (bx1 + bx2) // 2
        start_y = top + (by1 + by2) // 2
        if axis == "horizontal":
            end_x = right - max(8, (bx2 - bx1) // 2 + 3)
            end_y = start_y
        else:
            end_x = start_x
            end_y = bottom - max(8, (by2 - by1) // 2 + 3)

        gate.user32.SetCursorPos(start_x, start_y)
        time.sleep(0.05)
        gate.user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        drag_regions: list[dict[str, object]] = []
        try:
            for step in range(1, 13):
                x = start_x + (end_x - start_x) * step // 12
                y = start_y + (end_y - start_y) * step // 12
                gate.user32.SetCursorPos(x, y)
                time.sleep(0.04)
                metrics = window_region_metrics(hwnd)
                require_thumb_only_region(axis, f"drag-{step}", surface, metrics)
                drag_regions.append(metrics)
        finally:
            gate.user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)

        gate.user32.SetCursorPos(900, 40)
        time.sleep(0.25)
        hidden_after = window_region_metrics(hwnd)
        require_hidden_region(axis, "hidden-after-leave", hidden_after)

        records.append(
            {
                "axis": axis,
                "full_surface_rect": [left, top, right, bottom],
                "hidden_before": hidden_before,
                "hover_visible": visible,
                "hover_thumb_pixels": int(hover_thumb["pixels"]),
                "drag_region_samples": drag_regions,
                "hidden_after_leave": hidden_after,
                "single_thumb_region_only": True,
                "broad_surface_region_never_visible": True,
            }
        )
    return records


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    args = parser.parse_args()

    exe = args.exe.resolve()
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    isolated = Path(tempfile.mkdtemp(prefix="mediova-round12-scroll-overlay-"))
    env = os.environ.copy()
    env["APPDATA"] = str(isolated)
    env["LOCALAPPDATA"] = str(isolated)
    env["XDG_CONFIG_HOME"] = str(isolated)

    normal_compact = validate_normal_compact_surface(exe, env, evidence)

    process = subprocess.Popen(
        [str(exe), "--ui-preview=video", runner.ROUND11_SCROLL_PREVIEW_ARG],
        cwd=str(exe.parent),
        env=env,
    )
    try:
        main_hwnd = gate.find_window(process.pid, "Mediova", 20.0)
        records = runner.direct_surface_hover(main_hwnd, [], evidence)
        if len(records) != 2:
            raise RuntimeError(f"expected two overlay hover records, got {records!r}")

        report_records: list[dict[str, object]] = []
        for record in records:
            axis = str(record["axis"])
            baseline_path = evidence / f"hover-{axis}-baseline-hidden.png"
            visible_path = evidence / f"hover-{axis}-immediate-visible.png"
            hidden_path = evidence / f"hover-{axis}-left-hidden.png"
            with (
                Image.open(baseline_path) as baseline,
                Image.open(visible_path) as visible,
                Image.open(hidden_path) as hidden,
            ):
                visible_metrics = changed_metrics(baseline, visible)
                hidden_metrics = changed_metrics(baseline, hidden)
                transparent_metrics = validate_transparent_track(axis, baseline, visible)

            if float(hidden_metrics["changed_ratio"]) > 0.03:
                raise RuntimeError(f"{axis} overlay did not return to transparent state: {hidden_metrics!r}")

            item = dict(record)
            item.update(
                {
                    "visible_change": visible_metrics,
                    "hidden_after_leave_change": hidden_metrics,
                    "transparent_track_validation": transparent_metrics,
                    "show_delay_contract_ms": 0,
                    "thumb_overlay_visible": True,
                    "track_transparent": True,
                    "hidden_state_transparent": True,
                }
            )
            report_records.append(item)

        region_records = validate_window_region_ownership(main_hwnd, evidence)

        report = {
            "surface_class": "MWRound11StableScrollSurface",
            "axis_count": len(report_records),
            "native_track_absent": True,
            "transparent_track_required": True,
            "outside_thumb_transparency_required": True,
            "window_region_ownership_required": True,
            "broad_surface_region_forbidden": True,
            "normal_compact_validation": normal_compact,
            "normal_compact_native_scrollbars_hidden": True,
            "hover_delay_ms": 0,
            "records": report_records,
            "window_region_validation": region_records,
        }
        (evidence / "round12-scroll-overlay-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
        return 0
    finally:
        terminate_process(process)
        shutil.rmtree(isolated, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
