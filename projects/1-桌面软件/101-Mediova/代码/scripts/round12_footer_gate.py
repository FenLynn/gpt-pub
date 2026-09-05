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

from round11_flicker_gate import RECT, capture_window, find_window


user32 = ctypes.WinDLL("user32", use_last_error=True)

WM_COMMAND = 0x0111
IDC_TAB_VIDEO = 1001
IDC_TAB_IMAGE = 1002
IDC_RIGHT_TOGGLE = 1071
IDC_START = 1050
IDC_PAUSE = 1051
IDC_STOP = 1052

user32.GetDlgItem.argtypes = [wintypes.HWND, ctypes.c_int]
user32.GetDlgItem.restype = wintypes.HWND
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
user32.GetWindowRect.restype = wintypes.BOOL
user32.MoveWindow.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.BOOL]
user32.MoveWindow.restype = wintypes.BOOL
user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.SendMessageW.restype = ctypes.c_ssize_t


def window_rect(hwnd: int) -> tuple[int, int, int, int]:
    value = RECT()
    if not user32.GetWindowRect(hwnd, ctypes.byref(value)):
        raise ctypes.WinError(ctypes.get_last_error())
    return value.left, value.top, value.right, value.bottom


def get_control(hwnd: int, control_id: int) -> int:
    control = int(user32.GetDlgItem(hwnd, control_id))
    if not control:
        raise RuntimeError(f"control not found: {control_id}")
    return control


def overlaps(left: tuple[int, int, int, int], right: tuple[int, int, int, int]) -> bool:
    return left[0] < right[2] and left[2] > right[0] and left[1] < right[3] and left[3] > right[1]


def validate_footer(main_hwnd: int, controls: dict[str, int], step: int) -> dict[str, Any]:
    main = window_rect(main_hwnd)
    rects = {name: window_rect(handle) for name, handle in controls.items()}
    start, pause, stop = rects["start"], rects["pause"], rects["stop"]

    tops = {start[1], pause[1], stop[1]}
    heights = {start[3] - start[1], pause[3] - pause[1], stop[3] - stop[1]}
    if len(tops) != 1:
        raise RuntimeError(f"footer row mismatch at step {step}: {rects!r}")
    if len(heights) != 1:
        raise RuntimeError(f"footer height mismatch at step {step}: {rects!r}")
    if not (start[2] < pause[0] and pause[2] < stop[0]):
        raise RuntimeError(f"footer order/gap invalid at step {step}: {rects!r}")
    if overlaps(start, pause) or overlaps(pause, stop) or overlaps(start, stop):
        raise RuntimeError(f"footer overlap at step {step}: {rects!r}")

    widths = {name: rects[name][2] - rects[name][0] for name in ("start", "pause", "stop")}
    if widths["start"] < 120 or widths["pause"] < 90 or widths["stop"] < 90:
        raise RuntimeError(f"footer button too narrow for icon and text at step {step}: {widths!r}")
    button_height = start[3] - start[1]
    if button_height < 32:
        raise RuntimeError(f"footer button height collapsed at step {step}: height={button_height} rects={rects!r}")

    gap_start_pause = pause[0] - start[2]
    gap_pause_stop = stop[0] - pause[2]
    right_safe = main[2] - stop[2]
    if gap_start_pause < 9 or gap_pause_stop < 9:
        raise RuntimeError(
            f"footer inter-button safety gap too small at step {step}: "
            f"start_pause={gap_start_pause} pause_stop={gap_pause_stop}"
        )
    if right_safe < 10:
        raise RuntimeError(f"footer right safety margin too small at step {step}: margin={right_safe} rects={rects!r}")

    for name, rect in rects.items():
        if rect[0] < main[0] or rect[1] < main[1] or rect[2] > main[2] or rect[3] > main[3]:
            raise RuntimeError(f"footer control outside window at step {step}: {name}={rect!r}, main={main!r}")
        if rect[2] <= rect[0] or rect[3] <= rect[1]:
            raise RuntimeError(f"footer control has invalid size at step {step}: {name}={rect!r}")

    return {
        "step": step,
        "main": list(main),
        "rects": {name: list(rect) for name, rect in rects.items()},
        "right_safe_margin": right_safe,
        "start_pause_gap": gap_start_pause,
        "pause_stop_gap": gap_pause_stop,
        "button_height": button_height,
    }


def bottom_hash(hwnd: int, save_path: Path | None = None) -> str:
    frame = capture_window(hwnd)
    try:
        top = max(0, int(frame.height * 0.83))
        crop = frame.crop((0, top, frame.width, frame.height))
        try:
            if save_path is not None:
                crop.save(save_path)
            return hashlib.sha256(crop.tobytes()).hexdigest()
        finally:
            crop.close()
    finally:
        frame.close()


def merge_report(evidence: Path, footer_report: dict[str, Any]) -> None:
    report_path = evidence / "flicker-report.json"
    combined: dict[str, Any] = {}
    if report_path.is_file():
        combined = json.loads(report_path.read_text(encoding="utf-8"))
    combined["round12_footer"] = footer_report
    report_path.write_text(json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8")
    (evidence / "footer-report.json").write_text(
        json.dumps(footer_report, ensure_ascii=False, indent=2), encoding="utf-8"
    )


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

    isolated = Path(tempfile.mkdtemp(prefix="mediova-round12-footer-"))
    env = os.environ.copy()
    env["APPDATA"] = str(isolated)
    env["LOCALAPPDATA"] = str(isolated)

    process = subprocess.Popen([str(exe), "--ui-preview=video"], cwd=str(exe.parent), env=env)
    report: dict[str, Any] = {"iterations": 0, "samples": [], "stable_frames": 0, "stable_unique_hashes": 0}
    try:
        hwnd = find_window(process.pid, "Mediova", 20.0)
        controls = {
            "start": get_control(hwnd, IDC_START),
            "pause": get_control(hwnd, IDC_PAUSE),
            "stop": get_control(hwnd, IDC_STOP),
        }
        sizes = [(1650, 930), (1450, 820), (1120, 720), (1380, 760), (1920, 1000), (1000, 680)]
        samples: list[dict[str, Any]] = []
        all_checks: list[dict[str, Any]] = []
        for step in range(180):
            width, height = sizes[step % len(sizes)]
            if not user32.MoveWindow(hwnd, 0, 0, width, height, True):
                raise ctypes.WinError(ctypes.get_last_error())
            if step % 2 == 0:
                user32.SendMessageW(hwnd, WM_COMMAND, IDC_RIGHT_TOGGLE, 0)
            user32.SendMessageW(hwnd, WM_COMMAND, IDC_TAB_IMAGE if step % 3 == 0 else IDC_TAB_VIDEO, 0)
            time.sleep(0.025)
            sample = validate_footer(hwnd, controls, step)
            all_checks.append(sample)
            if step < 6 or step >= 174:
                samples.append(sample)

        time.sleep(0.6)
        stable_hashes: list[str] = []
        for frame_index in range(40):
            stable_hashes.append(
                bottom_hash(hwnd, evidence / f"footer-stable-{frame_index:02d}.png" if frame_index in (0, 39) else None)
            )
            all_checks.append(validate_footer(hwnd, controls, 180 + frame_index))
            time.sleep(0.05)
        unique = list(dict.fromkeys(stable_hashes))
        if len(unique) != 1:
            raise RuntimeError(f"footer region is unstable after stress: {len(unique)} unique hashes")

        report.update(
            {
                "iterations": 180,
                "samples": samples,
                "stable_frames": 40,
                "stable_unique_hashes": len(unique),
                "stable_hash": unique[0],
                "minimum_right_safe_margin": min(int(item["right_safe_margin"]) for item in all_checks),
                "minimum_start_pause_gap": min(int(item["start_pause_gap"]) for item in all_checks),
                "minimum_pause_stop_gap": min(int(item["pause_stop_gap"]) for item in all_checks),
                "minimum_button_height": min(int(item["button_height"]) for item in all_checks),
                "compact_typography_owner": True,
            }
        )
        merge_report(evidence, report)
        print(json.dumps(report, ensure_ascii=True, separators=(",", ":")))
        return 0
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=10)
        shutil.rmtree(isolated, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
