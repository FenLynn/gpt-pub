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
from round12_real_thumbnail_gate import choose_real_file, generate_fixture
from round12_remote_header import RemoteHeaderReader

BM_CLICK = 0x00F5
WM_SETTEXT = 0x000C
WM_LBUTTONDOWN = 0x0201
WM_LBUTTONUP = 0x0202
MK_LBUTTON = 0x0001
LVM_FIRST = 0x1000
LVM_GETITEMCOUNT = LVM_FIRST + 4
LVM_GETITEMSTATE = LVM_FIRST + 44
LVIS_SELECTED = 0x0002
IDC_LIST = 1020
IDC_TRIM_CROP = 1068
IDC_PREVIEW_CANVAS = 4013
IDC_CURRENT_TIME = 4015
IDC_JUMP_TIME = 4016


def child_by_handle(parent: int, handle: int) -> dict[str, object]:
    return next(child for child in gate.enumerate_children(parent) if int(child["hwnd"]) == handle)


def find_editor(pid: int, timeout: float) -> int:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        found = 0

        @gate.WNDENUMPROC
        def callback(hwnd: int, _lparam: int) -> bool:
            nonlocal found
            candidate = wintypes.DWORD()
            gate.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(candidate))
            if candidate.value != pid or not gate.user32.IsWindowVisible(hwnd):
                return True
            if gate.class_name(hwnd) == "MWRound7Editor":
                found = int(hwnd)
                return False
            return True

        gate.user32.EnumWindows(callback, 0)
        if found:
            return found
        time.sleep(0.05)
    return 0


def canvas_snapshot(editor: int, canvas: int, evidence: Path | None = None) -> dict[str, object]:
    info = child_by_handle(editor, canvas)
    image = runner.capture_screen_rect(info["rect"])
    try:
        rgb = image.convert("RGB")
        try:
            pixels = list(rgb.getdata())
            unique = len(set(pixels))
            saturated = sum(1 for r, g, b in pixels if max(r, g, b) - min(r, g, b) >= 70)
            lumas = [(77 * r + 150 * g + 29 * b) >> 8 for r, g, b in pixels]
            luma_span = max(lumas) - min(lumas) if lumas else 0
        finally:
            rgb.close()
        if evidence is not None:
            image.save(evidence)
        return {
            "hash": hashlib.sha256(image.tobytes()).hexdigest(),
            "unique_colors": unique,
            "saturated_pixels": saturated,
            "luma_span": luma_span,
        }
    finally:
        image.close()


def snapshot_is_real(value: dict[str, object]) -> bool:
    return int(value["unique_colors"]) >= 100 and int(value["saturated_pixels"]) >= 500 and int(value["luma_span"]) >= 80


def preview_failure_texts(editor: int) -> list[str]:
    failures: list[str] = []
    for child in gate.enumerate_children(editor):
        text = str(child["text"])
        if "预览帧生成失败" in text or "预览帧加载失败" in text or "预览帧自动恢复失败" in text:
            failures.append(text)
    return failures


def wait_for_real_canvas(editor: int, canvas: int, timeout: float, previous_hash: str | None = None) -> dict[str, object]:
    deadline = time.monotonic() + timeout
    best: dict[str, object] = {"hash": "", "unique_colors": 0, "saturated_pixels": 0, "luma_span": 0}
    while time.monotonic() < deadline:
        current = canvas_snapshot(editor, canvas)
        if int(current["unique_colors"]) > int(best["unique_colors"]):
            best = current
        changed = previous_hash is None or str(current["hash"]) != previous_hash
        if changed and snapshot_is_real(current) and not preview_failure_texts(editor):
            return current
        time.sleep(0.15)
    raise RuntimeError(
        f"trim preview did not reach a new valid frame: previous={previous_hash} best={best} failures={preview_failure_texts(editor)!r}"
    )


def set_current_and_jump(editor: int, current_edit: int, jump_button: int, value: str) -> None:
    text = ctypes.create_unicode_buffer(value)
    gate.user32.SendMessageW(current_edit, WM_SETTEXT, 0, ctypes.addressof(text))
    gate.user32.SendMessageW(jump_button, BM_CLICK, 0, 0)


def select_first_row(list_hwnd: int, reader: RemoteHeaderReader) -> None:
    row = reader.list_item_rect(list_hwnd, 0)
    x = max(8, min(int(row[2]) - 8, 180))
    y = max(4, (int(row[1]) + int(row[3])) // 2)
    lparam = (y & 0xFFFF) << 16 | (x & 0xFFFF)
    gate.user32.SendMessageW(list_hwnd, WM_LBUTTONDOWN, MK_LBUTTON, lparam)
    gate.user32.SendMessageW(list_hwnd, WM_LBUTTONUP, 0, lparam)
    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline:
        state = int(gate.user32.SendMessageW(list_hwnd, LVM_GETITEMSTATE, 0, LVIS_SELECTED))
        if state & LVIS_SELECTED:
            return
        time.sleep(0.05)
    raise RuntimeError("first imported task could not be selected")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    args = parser.parse_args()

    exe = args.exe.resolve()
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    ffmpeg = exe.parent / "Components" / "FFmpeg" / "bin" / "ffmpeg.exe"
    if not ffmpeg.is_file():
        raise RuntimeError(f"bundled FFmpeg not found: {ffmpeg}")

    isolated = Path(tempfile.mkdtemp(prefix="mediova-round12-trim-preview-"))
    fixture = isolated / "round12-trim-preview-testsrc.mp4"
    generate_fixture(ffmpeg, fixture)
    env = os.environ.copy()
    env["APPDATA"] = str(isolated / "AppData")
    env["LOCALAPPDATA"] = str(isolated / "LocalAppData")
    process = subprocess.Popen([str(exe)], cwd=str(exe.parent), env=env)
    reader: RemoteHeaderReader | None = None
    try:
        main_hwnd = gate.find_window(process.pid, "Mediova", 25.0)
        if not gate.user32.MoveWindow(main_hwnd, 0, 0, 1250, 800, True):
            raise ctypes.WinError(ctypes.get_last_error())
        time.sleep(1.5)
        list_hwnd = int(gate.user32.GetDlgItem(main_hwnd, IDC_LIST))
        trim_button = int(gate.user32.GetDlgItem(main_hwnd, IDC_TRIM_CROP))
        if not list_hwnd or not trim_button:
            raise RuntimeError("task list or trim button not found")
        choose_real_file(main_hwnd, process.pid, fixture)
        deadline = time.monotonic() + 15.0
        while time.monotonic() < deadline:
            if int(gate.user32.SendMessageW(list_hwnd, LVM_GETITEMCOUNT, 0, 0)) > 0:
                break
            time.sleep(0.10)
        else:
            raise RuntimeError("real trim fixture did not enter task list")

        reader = RemoteHeaderReader(process.pid)
        select_first_row(list_hwnd, reader)
        gate.user32.SendMessageW(trim_button, BM_CLICK, 0, 0)
        editor = find_editor(process.pid, 12.0)
        if not editor:
            raise RuntimeError("Round7 trim editor did not open")
        canvas = int(gate.user32.GetDlgItem(editor, IDC_PREVIEW_CANVAS))
        current_edit = int(gate.user32.GetDlgItem(editor, IDC_CURRENT_TIME))
        jump_button = int(gate.user32.GetDlgItem(editor, IDC_JUMP_TIME))
        if not canvas or not current_edit or not jump_button:
            raise RuntimeError("trim editor preview/current/jump controls not found")

        initial = wait_for_real_canvas(editor, canvas, 12.0)
        canvas_snapshot(editor, canvas, evidence / "round12-trim-preview-initial.png")

        # Exact media end is the known fragile case for fast -ss frame grabs.
        set_current_and_jump(editor, current_edit, jump_button, "00:00:02.000")
        terminal = wait_for_real_canvas(editor, canvas, 16.0, str(initial["hash"]))
        canvas_snapshot(editor, canvas, evidence / "round12-trim-preview-terminal.png")

        hashes = {str(initial["hash"]), str(terminal["hash"])}
        previous = str(terminal["hash"])
        for value in ("00:00:00.250", "00:00:01.750", "00:00:00.600", "00:00:01.950", "00:00:01.100"):
            set_current_and_jump(editor, current_edit, jump_button, value)
            current = wait_for_real_canvas(editor, canvas, 10.0, previous)
            previous = str(current["hash"])
            hashes.add(previous)

        final = canvas_snapshot(editor, canvas, evidence / "round12-trim-preview-final.png")
        failures = preview_failure_texts(editor)
        if failures:
            raise RuntimeError(f"trim preview still exposes failure text after stress sequence: {failures!r}")
        if len(hashes) < 5:
            raise RuntimeError(f"trim preview did not visibly update across seek sequence: unique_hashes={len(hashes)}")

        report = {
            "real_file_imported": True,
            "editor_class": gate.class_name(editor),
            "initial": initial,
            "terminal_exact_end": terminal,
            "final": final,
            "seek_sequence_count": 6,
            "unique_canvas_hashes": len(hashes),
            "failure_texts": failures,
            "exact_end_preview_recovered": True,
            "continuous_seek_preview_stable": True,
        }
        (evidence / "round12-trim-preview-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
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
