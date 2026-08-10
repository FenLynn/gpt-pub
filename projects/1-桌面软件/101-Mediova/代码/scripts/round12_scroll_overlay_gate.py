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

        report = {
            "surface_class": "MWRound11StableScrollSurface",
            "axis_count": len(report_records),
            "native_track_absent": True,
            "transparent_track_required": True,
            "outside_thumb_transparency_required": True,
            "normal_compact_validation": normal_compact,
            "normal_compact_native_scrollbars_hidden": True,
            "hover_delay_ms": 0,
            "records": report_records,
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
