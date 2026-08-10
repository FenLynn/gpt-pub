from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from PIL import Image, ImageChops

import round11_flicker_gate as gate
import round11_flicker_gate_runner_base as runner

THUMB_COLORS = runner.INLINE_THUMB_COLORS
HOVER_DELAY_MS = 0
IMMEDIATE_SAMPLE_SECONDS = 0.12
FORBIDDEN_SCROLL_CLASSES = {"MWRound9ScrollCover", "MWRound11StableScrollSurface"}


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
        raise RuntimeError(f"scrollbar child windows still exist: {forbidden!r}")
    runner.normal_list_geometry(main_hwnd)
    return lists[0]


def capture_list(main_hwnd: int, path: Path | None = None) -> Image.Image:
    image = runner.capture_screen_rect(runner.visible_list_rect(main_hwnd)).convert("RGB")
    if path is not None:
        image.save(path)
    return image


def thumb_metrics(image: Image.Image, axis: str | None = None) -> dict[str, object]:
    zone = max(24, min(34, min(image.width, image.height) // 8))
    points: list[tuple[int, int]] = []
    for y in range(image.height):
        for x in range(image.width):
            if axis == "horizontal":
                candidate = y >= image.height - zone and x < image.width - zone // 2
            elif axis == "vertical":
                candidate = x >= image.width - zone and y >= 20 and y < image.height - zone // 2
            else:
                candidate = (
                    (y >= image.height - zone and x < image.width - zone // 2)
                    or (x >= image.width - zone and y >= 20 and y < image.height - zone // 2)
                )
            if candidate and image.getpixel((x, y)) in THUMB_COLORS:
                points.append((x, y))
    if not points:
        return {"pixels": 0, "bbox": None, "axis": None}
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    bbox = (min(xs), min(ys), max(xs) + 1, max(ys) + 1)
    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    detected = "horizontal" if width > height else "vertical"
    if axis is not None and detected != axis:
        return {"pixels": 0, "bbox": None, "axis": detected, "width": width, "height": height}
    return {
        "pixels": len(points),
        "bbox": list(bbox),
        "axis": detected,
        "width": width,
        "height": height,
    }


def outside_thumb_change(before: Image.Image, after: Image.Image, bbox: list[int]) -> dict[str, object]:
    diff = ImageChops.difference(before, after).convert("L")
    try:
        mask = diff.point(lambda value: 255 if value >= 10 else 0)
        try:
            x1, y1, x2, y2 = [int(value) for value in bbox]
            margin = 2
            x1 = max(0, x1 - margin)
            y1 = max(0, y1 - margin)
            x2 = min(mask.width, x2 + margin)
            y2 = min(mask.height, y2 + margin)
            pixels = mask.load()
            changed = 0
            compared = 0
            for y in range(mask.height):
                for x in range(mask.width):
                    if x1 <= x < x2 and y1 <= y < y2:
                        continue
                    compared += 1
                    if pixels[x, y]:
                        changed += 1
            return {
                "changed_pixels": changed,
                "compared_pixels": compared,
                "changed_ratio": changed / max(1, compared),
            }
        finally:
            mask.close()
    finally:
        diff.close()


def validate_axis(main_hwnd: int, axis: str, evidence: Path) -> dict[str, object]:
    geometry = runner.normal_list_geometry(main_hwnd)
    runner.park_cursor(main_hwnd)
    baseline = capture_list(main_hwnd, evidence / f"inline-{axis}-baseline.png")
    try:
        base_metrics = thumb_metrics(baseline)
        if int(base_metrics["pixels"]) != 0:
            raise RuntimeError(f"{axis} thumb visible at baseline: {base_metrics!r}")

        x, y = runner.inline_hover_point(main_hwnd, axis)
        gate.user32.SetCursorPos(x, y)
        time.sleep(IMMEDIATE_SAMPLE_SECONDS)
        visible = capture_list(main_hwnd, evidence / f"inline-{axis}-immediate.png")
        try:
            metrics = thumb_metrics(visible, axis)
            if int(metrics["pixels"]) <= 0 or metrics["bbox"] is None:
                raise RuntimeError(f"{axis} inline thumb not visible immediately: {metrics!r}")
            if axis == "horizontal" and int(metrics.get("height", 999)) > 10:
                raise RuntimeError(f"horizontal thumb became a broad layer: {metrics!r}")
            if axis == "vertical" and int(metrics.get("width", 999)) > 10:
                raise RuntimeError(f"vertical thumb became a broad layer: {metrics!r}")
            track = outside_thumb_change(baseline, visible, metrics["bbox"])
            if float(track["changed_ratio"]) > 0.005:
                raise RuntimeError(f"{axis} transparent track changed outside thumb: {track!r}")

            hashes: list[bytes] = []
            counts: list[int] = []
            for frame in range(20):
                if frame:
                    time.sleep(0.04)
                runner.normal_list_geometry(main_hwnd)
                sample = capture_list(main_hwnd)
                try:
                    sample_metrics = thumb_metrics(sample, axis)
                    hashes.append(sample.tobytes())
                    counts.append(int(sample_metrics["pixels"]))
                finally:
                    sample.close()
            if len(set(hashes)) != 1 or min(counts) <= 0:
                raise RuntimeError(f"{axis} inline thumb flickered while stationary")

            runner.park_cursor(main_hwnd)
            hidden = capture_list(main_hwnd, evidence / f"inline-{axis}-left-hidden.png")
            try:
                hidden_metrics = thumb_metrics(hidden)
                if int(hidden_metrics["pixels"]) != 0:
                    raise RuntimeError(f"{axis} inline thumb remained after leave: {hidden_metrics!r}")
            finally:
                hidden.close()

            return {
                "axis": axis,
                "hover_delay_ms": HOVER_DELAY_MS,
                "visible_after_enter_ms": int(IMMEDIATE_SAMPLE_SECONDS * 1000),
                "thumb": metrics,
                "track_transparent": True,
                "outside_thumb_change": track,
                "hover_frames": 20,
                "hover_unique_frames": 1,
                "hidden_after_leave": True,
                "child_scrollbar_windows": 0,
                "native_scroll_style_bits": 0,
                "list_geometry": geometry,
            }
        finally:
            visible.close()
    finally:
        baseline.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    args = parser.parse_args()

    exe = args.exe.resolve()
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    isolated = Path(tempfile.mkdtemp(prefix="mediova-round12-inline-overlay-"))
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
        geometry = runner.normal_list_geometry(main_hwnd)
        records = [
            validate_axis(main_hwnd, "horizontal", evidence),
            validate_axis(main_hwnd, "vertical", evidence),
        ]
        report = {
            "architecture": "single-listview-inline-thumb",
            "scrollbar_child_windows_forbidden": True,
            "scrollbar_child_window_count": 0,
            "native_scroll_style_bits": 0,
            "physical_list_rect": child["rect"],
            "list_geometry": geometry,
            "hover_delay_ms": HOVER_DELAY_MS,
            "track_transparent": True,
            "overflow": overflow,
            "records": records,
        }
        (evidence / "round12-scroll-overlay-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(report, ensure_ascii=True, separators=(",", ":")))
        return 0
    finally:
        terminate_process(process)
        shutil.rmtree(isolated, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
