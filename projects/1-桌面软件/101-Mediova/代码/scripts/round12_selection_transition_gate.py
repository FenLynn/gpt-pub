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

import round11_flicker_gate as gate
import round11_flicker_gate_runner_base as runner
from round12_list_gate_helpers import EXPECTED_SELECTION, close_color, dark_pixels, sample_background
from round12_list_structure_gate import child_by_handle, read_relative_cells
from round12_remote_header import RemoteHeaderReader, header_handle
from round12_remote_memory import RemoteMemoryBlock

IDC_LIST = 1020
LVM_FIRST = 0x1000
LVM_SETITEMSTATE = LVM_FIRST + 43
LVIS_FOCUSED = 0x0001
LVIS_SELECTED = 0x0002


class LVITEMW(ctypes.Structure):
    _fields_ = [
        ("mask", wintypes.UINT),
        ("iItem", ctypes.c_int),
        ("iSubItem", ctypes.c_int),
        ("state", wintypes.UINT),
        ("stateMask", wintypes.UINT),
        ("pszText", ctypes.c_void_p),
        ("cchTextMax", ctypes.c_int),
        ("iImage", ctypes.c_int),
        ("lParam", ctypes.c_ssize_t),
        ("iIndent", ctypes.c_int),
        ("iGroupId", ctypes.c_int),
        ("cColumns", wintypes.UINT),
        ("puColumns", ctypes.c_void_p),
        ("piColFmt", ctypes.c_void_p),
        ("iGroup", ctypes.c_int),
    ]


gate.user32.GetDlgItem.argtypes = [wintypes.HWND, ctypes.c_int]
gate.user32.GetDlgItem.restype = wintypes.HWND
gate.user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
gate.user32.SendMessageW.restype = ctypes.c_ssize_t


def set_selected_row(list_hwnd: int, remote: RemoteMemoryBlock, row: int) -> None:
    item = LVITEMW()
    item.stateMask = LVIS_SELECTED | LVIS_FOCUSED
    item.state = 0
    remote.write(int(remote.address), item, ctypes.sizeof(item))
    all_items = ctypes.c_size_t(-1).value
    gate.user32.SendMessageW(list_hwnd, LVM_SETITEMSTATE, all_items, int(remote.address))

    item.state = LVIS_SELECTED | LVIS_FOCUSED
    remote.write(int(remote.address), item, ctypes.sizeof(item))
    result = gate.user32.SendMessageW(list_hwnd, LVM_SETITEMSTATE, row, int(remote.address))
    if not result:
        raise RuntimeError(f"LVM_SETITEMSTATE failed for row={row}")


def text_dark_pixels(image, cell: list[int]) -> int:
    left, top, right, bottom = [int(value) for value in cell]
    left += 8
    right -= 5
    top += 7
    bottom -= 7
    if right <= left or bottom <= top:
        return 0
    crop = image.crop((left, top, right, bottom))
    try:
        return dark_pixels(crop)
    finally:
        crop.close()


def validate_transition_frame(image, target_row: int, cells: list[list[list[int]]]) -> dict[str, object]:
    samples: list[list[int]] = []
    for column in range(0, 7):
        sample = sample_background(image, cells[target_row][column])
        samples.append(list(sample))
        if not close_color(sample, EXPECTED_SELECTION):
            raise RuntimeError(
                f"selected strip broke during transition: row={target_row} column={column} sample={sample}"
            )

    filename_dark = text_dark_pixels(image, cells[target_row][2])
    if filename_dark < 24:
        raise RuntimeError(
            f"selected filename disappeared during transition: row={target_row} dark_pixels={filename_dark}"
        )
    number_dark = text_dark_pixels(image, cells[target_row][0])
    if number_dark < 3:
        raise RuntimeError(
            f"selected row number disappeared during transition: row={target_row} dark_pixels={number_dark}"
        )
    return {
        "row": target_row,
        "selected_background_samples": samples,
        "filename_dark_pixels": filename_dark,
        "number_dark_pixels": number_dark,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    args = parser.parse_args()

    exe = args.exe.resolve()
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    isolated = Path(tempfile.mkdtemp(prefix="mediova-round12-selection-"))
    env = os.environ.copy()
    env["APPDATA"] = str(isolated)
    env["LOCALAPPDATA"] = str(isolated)

    process = subprocess.Popen([str(exe), "--ui-preview=video"], cwd=str(exe.parent), env=env)
    reader: RemoteHeaderReader | None = None
    remote: RemoteMemoryBlock | None = None
    try:
        main_hwnd = gate.find_window(process.pid, "Mediova", 20.0)
        if not gate.user32.MoveWindow(main_hwnd, 0, 0, 1650, 930, True):
            raise ctypes.WinError(ctypes.get_last_error())
        time.sleep(1.0)

        list_hwnd = int(gate.user32.GetDlgItem(main_hwnd, IDC_LIST))
        if not list_hwnd:
            raise RuntimeError("task list not found")
        header = header_handle(main_hwnd)
        reader = RemoteHeaderReader(process.pid)
        captions = reader.titles(int(header["hwnd"]))
        list_info = child_by_handle(main_hwnd, list_hwnd)
        cells, _rows = read_relative_cells(reader, list_hwnd, len(captions), list_info)
        if len(cells) < 3:
            raise RuntimeError(f"selection transition fixture has too few rows: {len(cells)}")

        remote = RemoteMemoryBlock(process.pid, max(256, ctypes.sizeof(LVITEMW)))
        transitions = [1, 2, 0, 2, 1, 0, 1, 2, 0]
        samples: list[dict[str, object]] = []
        frame_count = 0
        for transition_index, target in enumerate(transitions):
            set_selected_row(list_hwnd, remote, target)
            # Sample the visible transition itself, not just a long-settled row.
            # 15 ms is below a normal 60 Hz frame and catches the previous
            # prepaint-then-subitem blanking path without relying on mouse input.
            time.sleep(0.015)
            for frame_index in range(8):
                image = runner.capture_screen_rect(list_info["rect"])
                try:
                    frame = validate_transition_frame(image, target, cells)
                    frame["transition"] = transition_index
                    frame["frame"] = frame_index
                    samples.append(frame)
                    if frame_index in (0, 7):
                        image.save(
                            evidence
                            / f"round12-selection-transition-{transition_index:02d}-{frame_index:02d}.png"
                        )
                finally:
                    image.close()
                frame_count += 1
                time.sleep(0.015)

        report = {
            "transitions": transitions,
            "transition_count": len(transitions),
            "frames_per_transition": 8,
            "frames_validated": frame_count,
            "minimum_filename_dark_pixels": min(int(item["filename_dark_pixels"]) for item in samples),
            "minimum_number_dark_pixels": min(int(item["number_dark_pixels"]) for item in samples),
            "selected_background_expected": list(EXPECTED_SELECTION),
            "no_selected_text_blank_frames": True,
            "continuous_selected_strip": True,
        }
        (evidence / "round12-selection-transition-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(report, ensure_ascii=True, separators=(",", ":")))
        return 0
    finally:
        if remote is not None:
            remote.close()
        if reader is not None:
            reader.close()
        if process.poll() is None:
            process.kill()
        process.wait(timeout=10)
        shutil.rmtree(isolated, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
