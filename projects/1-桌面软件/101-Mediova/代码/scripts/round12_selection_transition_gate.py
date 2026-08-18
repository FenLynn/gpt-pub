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
from round12_list_gate_helpers import (
    EXPECTED_STATUS_OTHER,
    EXPECTED_STATUS_PROCESSING,
    EXPECTED_STATUS_QUEUED,
    close_color,
    dark_pixels,
)
from round12_list_structure_gate import child_by_handle, read_relative_cells
from round12_remote_header import RemoteHeaderReader, header_handle
from round12_remote_memory import RemoteMemoryBlock

IDC_LIST = 1020
LVM_FIRST = 0x1000
LVM_SETITEMSTATE = LVM_FIRST + 43
LVIS_FOCUSED = 0x0001
LVIS_SELECTED = 0x0002
WM_LBUTTONDOWN = 0x0201
WM_LBUTTONUP = 0x0202
MK_LBUTTON = 0x0001

ROW_BACKGROUNDS = {
    0: EXPECTED_STATUS_OTHER,
    1: EXPECTED_STATUS_QUEUED,
    2: EXPECTED_STATUS_PROCESSING,
}
ROW_STATUS_TEXT = {
    0: (76, 96, 120),
    1: (53, 104, 166),
    2: (126, 78, 190),
}
SELECTION_BORDER = (50, 118, 205)


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
gate.user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
gate.user32.PostMessageW.restype = wintypes.BOOL


def sample_expected_background(image, cell: list[int], expected: tuple[int, int, int]) -> tuple[int, int, int]:
    left, top, right, bottom = [int(value) for value in cell]
    candidates = [
        (left + 3, top + 3),
        (right - 4, top + 3),
        (left + 3, bottom - 4),
        (right - 4, bottom - 4),
    ]
    samples: list[tuple[int, int, int]] = []
    for x, y in candidates:
        x = min(max(x, 0), image.width - 1)
        y = min(max(y, 0), image.height - 1)
        samples.append(tuple(int(value) for value in image.getpixel((x, y))[:3]))
    samples.sort(key=lambda value: sum(abs(value[index] - expected[index]) for index in range(3)))
    return samples[0]


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


def set_selected_rows(list_hwnd: int, remote: RemoteMemoryBlock, rows: list[int]) -> None:
    item = LVITEMW()
    item.stateMask = LVIS_SELECTED | LVIS_FOCUSED
    item.state = 0
    remote.write(int(remote.address), item, ctypes.sizeof(item))
    gate.user32.SendMessageW(
        list_hwnd, LVM_SETITEMSTATE, ctypes.c_size_t(-1).value, int(remote.address)
    )
    for index, row in enumerate(rows):
        item.state = LVIS_SELECTED | (LVIS_FOCUSED if index == len(rows) - 1 else 0)
        remote.write(int(remote.address), item, ctypes.sizeof(item))
        if not gate.user32.SendMessageW(list_hwnd, LVM_SETITEMSTATE, row, int(remote.address)):
            raise RuntimeError(f"LVM_SETITEMSTATE failed for grouped row={row}")


def colour_count_on_horizontal(image, y: int, expected: tuple[int, int, int]) -> int:
    y = min(max(y, 0), image.height - 1)
    return sum(
        1
        for x in range(image.width)
        if close_color(tuple(int(value) for value in image.getpixel((x, y))[:3]), expected, 4)
    )


def validate_grouped_outline(image, cells: list[list[list[int]]], first: int, last: int) -> dict[str, int]:
    first_top = int(cells[first][0][1])
    shared = int(cells[first][0][3])
    last_bottom = int(cells[last][0][3])
    top_count = max(
        colour_count_on_horizontal(image, y, SELECTION_BORDER)
        for y in range(first_top, min(first_top + 3, image.height))
    )
    shared_count = max(
        colour_count_on_horizontal(image, y, SELECTION_BORDER)
        for y in range(max(0, shared - 1), min(shared + 2, image.height))
    )
    bottom_count = max(
        colour_count_on_horizontal(image, y, SELECTION_BORDER)
        for y in range(max(0, last_bottom - 3), min(last_bottom, image.height))
    )
    required = int(image.width * 0.80)
    if top_count < required or bottom_count < required:
        raise RuntimeError(
            f"grouped selection outer horizontal border missing: top={top_count} bottom={bottom_count} required={required}"
        )
    if shared_count > 12:
        raise RuntimeError(f"contiguous selection still has an internal horizontal border: pixels={shared_count}")
    return {"top_pixels": top_count, "internal_pixels": shared_count, "bottom_pixels": bottom_count}


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


def status_text_pixels(image, cell: list[int], expected: tuple[int, int, int]) -> int:
    left, top, right, bottom = [int(value) for value in cell]
    # Skip the coloured status lamp. Matching pixels must come from the label,
    # proving selection did not replace its colour with the generic dark text.
    left += 24
    right -= 4
    top += 4
    bottom -= 4
    if right <= left or bottom <= top:
        return 0
    crop = image.crop((left, top, right, bottom)).convert("RGB")
    try:
        return sum(
            1
            for pixel in crop.getdata()
            if all(abs(int(pixel[channel]) - expected[channel]) <= 5 for channel in range(3))
        )
    finally:
        crop.close()


def validate_transition_frame(image, target_row: int, cells: list[list[list[int]]]) -> dict[str, object]:
    samples: dict[str, list[int]] = {}
    tail_samples: dict[str, list[int]] = {}
    status_pixels: dict[str, int] = {}
    for row in range(min(3, len(cells))):
        expected = ROW_BACKGROUNDS[row]
        visible_right = 0
        for column, cell in enumerate(cells[row]):
            left, top, right, bottom = [int(value) for value in cell]
            if right <= left or bottom <= top or left < 0 or right > image.width:
                continue
            sample = sample_expected_background(image, cell, expected)
            if not close_color(sample, expected, tolerance=6):
                raise RuntimeError(
                    f"status tint broke during selection transition: selected={target_row} "
                    f"row={row} column={column} sample={sample} expected={expected}"
                )
            samples[f"{row}:{column}"] = list(sample)
            visible_right = max(visible_right, right)

        # The area after the final visible column is the exact location where
        # the previous selected-row colour survived as a detached rectangle.
        if visible_right + 6 < image.width:
            x = min(image.width - 2, visible_right + 12)
            top = int(cells[row][0][1])
            bottom = int(cells[row][0][3])
            y = min(image.height - 2, max(0, (top + bottom) // 2))
            sample = tuple(int(value) for value in image.getpixel((x, y))[:3])
            if not close_color(sample, expected, tolerance=6):
                raise RuntimeError(
                    f"trailing row background is discontinuous: selected={target_row} "
                    f"row={row} sample={sample} expected={expected} at=({x},{y})"
                )
            tail_samples[str(row)] = list(sample)

        pixels = status_text_pixels(image, cells[row][12], ROW_STATUS_TEXT[row])
        if pixels < 5:
            raise RuntimeError(
                f"status text colour changed or disappeared: selected={target_row} row={row} "
                f"expected={ROW_STATUS_TEXT[row]} pixels={pixels}"
            )
        status_pixels[str(row)] = pixels

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
        "status_background_samples": samples,
        "trailing_background_samples": tail_samples,
        "status_text_pixels": status_pixels,
        "filename_dark_pixels": filename_dark,
        "number_dark_pixels": number_dark,
    }


def click_row(list_hwnd: int, cell: list[int]) -> None:
    left, top, right, bottom = [int(value) for value in cell]
    x = (left + right) // 2
    y = (top + bottom) // 2
    point = ((y & 0xFFFF) << 16) | (x & 0xFFFF)
    if not gate.user32.PostMessageW(list_hwnd, WM_LBUTTONDOWN, MK_LBUTTON, point):
        raise ctypes.WinError(ctypes.get_last_error())
    if not gate.user32.PostMessageW(list_hwnd, WM_LBUTTONUP, 0, point):
        raise ctypes.WinError(ctypes.get_last_error())


def selected_state(list_hwnd: int, row: int) -> int:
    return int(gate.user32.SendMessageW(list_hwnd, LVM_FIRST + 44, row, LVIS_SELECTED))


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

        # Exercise the queued mouse path, including a non-first subitem. A click
        # must move selection to the whole row promptly; no cell-only white box
        # or full-list synchronous repaint is allowed.
        click_target = 1
        click_started = time.perf_counter()
        click_row(list_hwnd, cells[click_target][3])
        click_deadline = click_started + 2.0
        states = [selected_state(list_hwnd, row) for row in range(3)]
        while time.perf_counter() < click_deadline:
            states = [selected_state(list_hwnd, row) for row in range(3)]
            if states == [0, LVIS_SELECTED, 0]:
                break
            time.sleep(0.01)
        else:
            raise RuntimeError(f"mouse click did not select exactly one whole row: states={states}")
        click_elapsed_ms = (time.perf_counter() - click_started) * 1000.0
        time.sleep(0.03)
        click_image = runner.capture_screen_rect(list_info["rect"])
        try:
            click_frame = validate_transition_frame(click_image, click_target, cells)
            click_image.save(evidence / "round12-selection-mouse-click.png")
        finally:
            click_image.close()

        set_selected_rows(list_hwnd, remote, [1, 2])
        time.sleep(0.05)
        grouped_image = runner.capture_screen_rect(list_info["rect"])
        try:
            grouped_frame_1 = validate_transition_frame(grouped_image, 1, cells)
            grouped_frame_2 = validate_transition_frame(grouped_image, 2, cells)
            grouped_outline = validate_grouped_outline(grouped_image, cells, 1, 2)
            grouped_image.save(evidence / "round12-selection-contiguous-group.png")
        finally:
            grouped_image.close()

        report = {
            "transitions": transitions,
            "transition_count": len(transitions),
            "frames_per_transition": 8,
            "frames_validated": frame_count,
            "minimum_filename_dark_pixels": min(int(item["filename_dark_pixels"]) for item in samples),
            "minimum_number_dark_pixels": min(int(item["number_dark_pixels"]) for item in samples),
            "status_backgrounds_expected": {
                str(row): list(colour) for row, colour in ROW_BACKGROUNDS.items()
            },
            "no_selected_text_blank_frames": True,
            "selection_preserves_status_backgrounds": True,
            "selection_preserves_status_text_colors": True,
            "full_row_tail_continuous": True,
            "mouse_click_whole_row": True,
            "mouse_click_elapsed_ms": round(click_elapsed_ms, 3),
            "mouse_click_frame": click_frame,
            "contiguous_selection_single_outline": True,
            "grouped_outline": grouped_outline,
            "grouped_frames": [grouped_frame_1, grouped_frame_2],
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
