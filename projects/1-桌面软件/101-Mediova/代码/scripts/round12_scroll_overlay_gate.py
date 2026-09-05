from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import round11_flicker_gate as gate
import round11_flicker_gate_runner_base as runner

NATIVE_SCROLL_ARCHITECTURE = "native-listview-scrollbars"
FORBIDDEN_SCROLL_CLASSES = {
    "MWRound9ScrollCover",
    "MWRound11StableScrollSurface",
    "MWRound12ThumbVisual",
    "MWRound12FrozenNumber",
}


def terminate_process(process: subprocess.Popen[bytes] | subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5.0)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5.0)


def native_list_state(main_hwnd: int) -> dict[str, object]:
    children = gate.enumerate_children(main_hwnd)
    lists = [child for child in children if child["class"] == "SysListView32"]
    if len(lists) != 1:
        raise RuntimeError(f"expected one ListView, got {lists!r}")
    forbidden = [child for child in children if child["class"] in FORBIDDEN_SCROLL_CLASSES]
    if forbidden:
        raise RuntimeError(f"custom scrollbar windows remain: {forbidden!r}")

    child = lists[0]
    style = int(str(child["style"]), 16)
    scroll_bits = style & (gate.WS_HSCROLL | gate.WS_VSCROLL)
    if not scroll_bits:
        raise RuntimeError(f"native ListView scrollbar styles are missing: style=0x{style:08x}")
    return {
        "hwnd": int(child["hwnd"]),
        "rect": child["rect"],
        "style": style,
        "exstyle": int(str(child["exstyle"]), 16),
        "native_scroll_style_bits": scroll_bits,
        "custom_scrollbar_window_count": 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    args = parser.parse_args()

    exe = args.exe.resolve()
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    isolated = Path(tempfile.mkdtemp(prefix="mediova-round12-native-scroll-"))
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
        state = native_list_state(main_hwnd)

        # Native scrollbar hover effects are owned by Windows and may animate.
        # Verify the settled list is stable without requiring custom thumb pixels.
        runner.park_cursor(main_hwnd)
        time.sleep(0.30)
        frames: list[bytes] = []
        for _ in range(12):
            frame = runner.capture_screen_rect(state["rect"]).convert("RGB")
            try:
                frames.append(frame.tobytes())
            finally:
                frame.close()
            time.sleep(0.04)
        if len(set(frames)) != 1:
            raise RuntimeError("native ListView changed while idle")

        report = {
            "architecture": NATIVE_SCROLL_ARCHITECTURE,
            "native_scrollbars_authoritative": True,
            "custom_scrollbar_windows_forbidden": True,
            "overflow": overflow,
            "list": state,
            "idle_frames": len(frames),
            "idle_unique_frames": len(set(frames)),
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
