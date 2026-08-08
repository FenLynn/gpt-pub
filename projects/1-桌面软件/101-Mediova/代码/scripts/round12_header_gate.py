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
from collections import Counter
from pathlib import Path

import round11_flicker_gate as gate
import round11_flicker_gate_runner_base as runner
from round12_remote_header import EXPECTED_CAPTIONS, RemoteHeaderReader, header_handle

WM_COMMAND = 0x0111
WM_MOUSEMOVE = 0x0200
WM_LBUTTONDOWN = 0x0201
WM_LBUTTONUP = 0x0202
MK_LBUTTON = 0x0001
IDC_TAB_VIDEO = 1001
IDC_TAB_IMAGE = 1002
EXPECTED_BOTTOM_SEPARATOR = (194, 203, 214)


def _close_color(value: tuple[int, int, int], expected: tuple[int, int, int], tolerance: int = 6) -> bool:
    return all(abs(int(value[index]) - int(expected[index])) <= tolerance for index in range(3))


def _edge_ratio(rgb, rows: range, expected: tuple[int, int, int]) -> tuple[float, int]:
    ratios: list[tuple[float, int]] = []
    for y in rows:
        if y < 0 or y >= rgb.height:
            continue
        pixels = [rgb.getpixel((x, y)) for x in range(rgb.width)]
        matches = sum(1 for pixel in pixels if _close_color(pixel, expected))
        ratios.append((matches / max(1, len(pixels)), y))
    return max(ratios, default=(0.0, -1))


def _dominant_top_color(header: dict[str, object]) -> tuple[tuple[int, int, int], float]:
    image = runner.capture_screen_rect(header["rect"])
    try:
        rgb = image.convert("RGB")
        try:
            pixels = [rgb.getpixel((x, 0)) for x in range(rgb.width)]
        finally:
            rgb.close()
    finally:
        image.close()
    if not pixels:
        raise RuntimeError("header top edge has no pixels")
    color, count = Counter(pixels).most_common(1)[0]
    return tuple(int(value) for value in color), count / len(pixels)


def capture_header(
    header: dict[str, object],
    top_expected: tuple[int, int, int],
    save: Path | None = None,
) -> tuple[str, float, int, float, int]:
    image = runner.capture_screen_rect(header["rect"])
    try:
        if save is not None:
            image.save(save)
        rgb = image.convert("RGB")
        try:
            bottom_ratio, bottom_y = _edge_ratio(
                rgb, range(max(0, rgb.height - 3), rgb.height), EXPECTED_BOTTOM_SEPARATOR
            )
            top_ratio, top_y = _edge_ratio(
                rgb, range(0, min(3, rgb.height)), top_expected
            )
        finally:
            rgb.close()
        return hashlib.sha256(image.tobytes()).hexdigest(), bottom_ratio, bottom_y, top_ratio, top_y
    finally:
        image.close()


def _lparam(x: int, y: int) -> int:
    return ((y & 0xFFFF) << 16) | (x & 0xFFFF)


def validate_pressed_header_items(
    reader: RemoteHeaderReader,
    current_header: dict[str, object],
    top_expected: tuple[int, int, int],
    evidence: Path,
) -> tuple[int, float]:
    hwnd = int(current_header["hwnd"])
    screen_rect = current_header["rect"]
    client_width = int(screen_rect[2]) - int(screen_rect[0])
    rects = reader.rects(hwnd)
    visible: list[tuple[int, list[int]]] = []
    for index, rect in enumerate(rects):
        left, top, right, bottom = (int(value) for value in rect)
        if right-left >= 8 and bottom-top >= 8 and left < client_width and right > 0:
            visible.append((index, [left, top, right, bottom]))
    if not visible:
        raise RuntimeError("no visible header items available for pressed-state validation")

    ratios: list[float] = []
    for order, (index, rect) in enumerate(visible):
        left, top, right, bottom = rect
        x = max(2, min(client_width - 2, (max(0, left) + min(client_width, right)) // 2))
        y = max(2, (top + bottom) // 2)
        point = _lparam(x, y)
        gate.user32.SendMessageW(hwnd, WM_MOUSEMOVE, 0, point)
        gate.user32.SendMessageW(hwnd, WM_LBUTTONDOWN, MK_LBUTTON, point)
        time.sleep(0.035)
        _digest, _bottom, _bottom_y, top_ratio, _top_y = capture_header(
            current_header,
            top_expected,
            evidence / f"header-pressed-col-{index:02d}.png" if order in (0, len(visible) - 1) else None,
        )
        ratios.append(top_ratio)
        gate.user32.SendMessageW(hwnd, WM_LBUTTONUP, 0, point)
        if top_ratio < 0.98:
            raise RuntimeError(
                f"header top separator disappeared in pressed column state: "
                f"column={index} ratio={top_ratio:.4f} rect={rect!r} expected={top_expected!r}"
            )
        time.sleep(0.02)

    return len(visible), min(ratios)


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
        if baseline != EXPECTED_CAPTIONS:
            raise RuntimeError(f"unexpected column set: {baseline!r}, want={EXPECTED_CAPTIONS!r}")

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
        current_header = header_handle(main_hwnd)
        top_expected, top_dominance = _dominant_top_color(current_header)
        if top_dominance < 0.98:
            raise RuntimeError(
                f"header stable top edge is not a continuous baseline: "
                f"dominant={top_expected!r} ratio={top_dominance:.4f}"
            )

        hashes: list[str] = []
        bottom_ratios: list[float] = []
        bottom_rows: list[int] = []
        top_ratios: list[float] = []
        top_rows: list[int] = []
        for frame in range(40):
            current_header = header_handle(main_hwnd)
            digest, bottom_ratio, bottom_row, top_ratio, top_row = capture_header(
                current_header,
                top_expected,
                evidence / f"header-stable-{frame:02d}.png" if frame in (0, 39) else None,
            )
            hashes.append(digest)
            bottom_ratios.append(bottom_ratio)
            bottom_rows.append(bottom_row)
            top_ratios.append(top_ratio)
            top_rows.append(top_row)
            if bottom_ratio < 0.98:
                raise RuntimeError(
                    f"header bottom separator is not continuous: frame={frame} ratio={bottom_ratio:.4f} row={bottom_row}"
                )
            if top_ratio < 0.98:
                raise RuntimeError(
                    f"header top separator is not continuous: frame={frame} ratio={top_ratio:.4f} "
                    f"row={top_row} expected={top_expected!r}"
                )
            if reader.titles(int(current_header["hwnd"])) != baseline:
                raise RuntimeError(f"header captions changed during stable frame {frame}")
            time.sleep(0.05)
        unique = list(dict.fromkeys(hashes))
        if len(unique) != 1:
            raise RuntimeError(f"header pixels are unstable: {len(unique)} unique hashes")

        current_header = header_handle(main_hwnd)
        pressed_count, pressed_min_ratio = validate_pressed_header_items(
            reader, current_header, top_expected, evidence
        )

        report = {
            "iterations": 240,
            "column_count": len(baseline),
            "captions": baseline,
            "empty_caption_count": 0,
            "stable_frames": 40,
            "stable_unique_hashes": 1,
            "stable_hash": unique[0],
            "bottom_separator_expected": list(EXPECTED_BOTTOM_SEPARATOR),
            "bottom_separator_min_ratio": min(bottom_ratios),
            "bottom_separator_rows": bottom_rows,
            "bottom_separator_continuous": True,
            "top_separator_detected": list(top_expected),
            "top_separator_baseline_dominance": top_dominance,
            "top_separator_min_ratio": min(top_ratios),
            "top_separator_rows": top_rows,
            "top_separator_continuous": True,
            "pressed_columns_validated": pressed_count,
            "pressed_top_separator_min_ratio": pressed_min_ratio,
            "pressed_top_separator_continuous": True,
        }
        (evidence / "header-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
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
