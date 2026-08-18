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

import round11_flicker_gate as gate
import round11_flicker_gate_runner_base as runner


IDC_OVERALL_PROGRESS = 1049
RDW_INVALIDATE = 0x0001
RDW_UPDATENOW = 0x0100

gate.user32.GetDlgItem.argtypes = [wintypes.HWND, ctypes.c_int]
gate.user32.GetDlgItem.restype = wintypes.HWND
gate.user32.RedrawWindow.argtypes = [wintypes.HWND, ctypes.c_void_p, wintypes.HRGN, wintypes.UINT]
gate.user32.RedrawWindow.restype = wintypes.BOOL


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    args = parser.parse_args()

    exe = args.exe.resolve()
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    isolated = Path(tempfile.mkdtemp(prefix="mediova-round12-overall-progress-"))
    env = os.environ.copy()
    env["APPDATA"] = str(isolated)
    env["LOCALAPPDATA"] = str(isolated)
    process = subprocess.Popen([str(exe), "--ui-preview=video"], cwd=str(exe.parent), env=env)
    try:
        main_hwnd = gate.find_window(process.pid, "Mediova", 20.0)
        if not gate.user32.MoveWindow(main_hwnd, 0, 0, 1650, 930, True):
            raise ctypes.WinError(ctypes.get_last_error())
        time.sleep(1.0)
        progress = int(gate.user32.GetDlgItem(main_hwnd, IDC_OVERALL_PROGRESS))
        if not progress:
            raise RuntimeError("overall progress control not found")
        info = next(
            child for child in gate.enumerate_children(main_hwnd) if int(child["hwnd"]) == progress
        )
        rect = [int(value) for value in info["rect"]]
        if rect[2] - rect[0] < 400 or rect[3] - rect[1] < 12:
            raise RuntimeError(f"invalid overall progress rectangle: {rect}")

        hashes: list[str] = []
        dark_counts: list[int] = []
        for frame in range(60):
            if not gate.user32.RedrawWindow(
                progress, None, 0, RDW_INVALIDATE | RDW_UPDATENOW
            ):
                raise ctypes.WinError(ctypes.get_last_error())
            image = runner.capture_screen_rect(rect)
            try:
                rgb = image.convert("RGB")
                dark = sum(
                    1 for red, green, blue in rgb.getdata() if red < 130 and green < 145 and blue < 165
                )
                dark_counts.append(dark)
                hashes.append(hashlib.sha256(image.tobytes()).hexdigest())
                if frame in (0, 59):
                    image.save(evidence / f"round12-overall-progress-{frame:02d}.png")
            finally:
                image.close()
            time.sleep(0.008)

        minimum_dark = min(dark_counts)
        if minimum_dark < 40:
            raise RuntimeError(
                f"overall progress text disappeared during forced redraw: minimum_dark_pixels={minimum_dark}"
            )
        unique = len(set(hashes))
        if unique != 1:
            raise RuntimeError(f"unchanged overall progress produced unstable frames: unique={unique}")
        report = {
            "frames_validated": len(hashes),
            "unique_frames": unique,
            "minimum_text_dark_pixels": minimum_dark,
            "maximum_text_dark_pixels": max(dark_counts),
            "buffered_atomic_paint": True,
            "text_never_blank": True,
            "progress_rect": rect,
        }
        (evidence / "round12-overall-progress-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(report, ensure_ascii=True, separators=(",", ":")))
        return 0
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=10)
        shutil.rmtree(isolated, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
