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
from pathlib import Path

import round11_flicker_gate as gate
import round11_flicker_gate_runner_base as runner
from round12_remote_header import EXPECTED_CAPTIONS, RemoteHeaderReader, header_handle

WM_COMMAND = 0x0111
IDC_TAB_VIDEO = 1001
IDC_TAB_IMAGE = 1002


def capture_header(header: dict[str, object], save: Path | None = None) -> str:
    image = runner.capture_screen_rect(header["rect"])
    try:
        if save is not None:
            image.save(save)
        return hashlib.sha256(image.tobytes()).hexdigest()
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
        hashes: list[str] = []
        for frame in range(40):
            current_header = header_handle(main_hwnd)
            hashes.append(capture_header(current_header, evidence / f"header-stable-{frame:02d}.png" if frame in (0, 39) else None))
            if reader.titles(int(current_header["hwnd"])) != baseline:
                raise RuntimeError(f"header captions changed during stable frame {frame}")
            time.sleep(0.05)
        unique = list(dict.fromkeys(hashes))
        if len(unique) != 1:
            raise RuntimeError(f"header pixels are unstable: {len(unique)} unique hashes")

        report = {
            "iterations": 240,
            "column_count": len(baseline),
            "captions": baseline,
            "empty_caption_count": 0,
            "stable_frames": 40,
            "stable_unique_hashes": 1,
            "stable_hash": unique[0],
        }
        (evidence / "header-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
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
