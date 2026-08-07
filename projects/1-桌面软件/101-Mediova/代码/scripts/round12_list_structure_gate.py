from __future__ import annotations

import argparse
import ctypes
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import round11_flicker_gate as gate
import round11_flicker_gate_runner_base as runner
from round12_list_gate_helpers import (
    EXPECTED_SELECTION,
    IDC_COLUMN_SETTINGS,
    IDC_LIST,
    IDC_RIGHT_TOGGLE,
    IDC_TAB_IMAGE,
    IDC_TAB_VIDEO,
    ROUND12_COLUMN_MENU_BASE,
    TASK_COL_DURATION,
    client_rect_to_screen,
    column_width,
    send_command,
)
from round12_list_gate_visual import validate_left_list_image, validate_right_list_image, validate_selected_stability
from round12_remote_header import EXPECTED_CAPTIONS, RemoteHeaderReader, header_handle

LVM_FIRST = 0x1000
LVM_SCROLL = LVM_FIRST + 20


def child_by_handle(main_hwnd: int, handle: int) -> dict[str, object]:
    return next(child for child in gate.enumerate_children(main_hwnd) if int(child["hwnd"]) == handle)


def read_relative_cells(
    reader: RemoteHeaderReader,
    list_hwnd: int,
    column_count: int,
    list_info: dict[str, object],
) -> tuple[list[list[list[int]]], list[list[int]]]:
    row_rects = [reader.list_item_rect(list_hwnd, row) for row in range(3)]
    subitems = [[reader.list_subitem_rect(list_hwnd, row, column) for column in range(column_count)] for row in range(3)]
    screen_rows = [client_rect_to_screen(list_hwnd, value) for value in row_rects]
    screen_cells = [[client_rect_to_screen(list_hwnd, value) for value in row] for row in subitems]
    origin_x, origin_y = int(list_info["rect"][0]), int(list_info["rect"][1])
    relative_cells = [
        [[cell[0] - origin_x, cell[1] - origin_y, cell[2] - origin_x, cell[3] - origin_y] for cell in row]
        for row in screen_cells
    ]
    return relative_cells, screen_rows


def merge_selected_samples(left: dict[int, list[int]], right: dict[int, list[int]], count: int) -> list[list[int]]:
    merged = {**left, **right}
    missing = [column for column in range(count) if column not in merged]
    if missing:
        raise RuntimeError(f"selected background columns were not all sampled: missing={missing}")
    return [merged[column] for column in range(count)]


def validate_column_profiles(main_hwnd: int, list_hwnd: int) -> dict[str, int]:
    video_before = column_width(list_hwnd, TASK_COL_DURATION)
    if video_before <= 0:
        raise RuntimeError(f"video duration column unexpectedly hidden before toggle: {video_before}")
    send_command(main_hwnd, ROUND12_COLUMN_MENU_BASE + TASK_COL_DURATION)
    video_hidden = column_width(list_hwnd, TASK_COL_DURATION)
    if video_hidden != 0:
        raise RuntimeError(f"video duration column did not hide: {video_hidden}")
    send_command(main_hwnd, IDC_TAB_IMAGE)
    image_visible = column_width(list_hwnd, TASK_COL_DURATION)
    if image_visible <= 0:
        raise RuntimeError(f"image column profile leaked hidden video duration: {image_visible}")
    send_command(main_hwnd, IDC_TAB_VIDEO)
    video_hidden_after_switch = column_width(list_hwnd, TASK_COL_DURATION)
    if video_hidden_after_switch != 0:
        raise RuntimeError(f"video hidden column state was not restored: {video_hidden_after_switch}")
    send_command(main_hwnd, ROUND12_COLUMN_MENU_BASE + TASK_COL_DURATION)
    video_restored = column_width(list_hwnd, TASK_COL_DURATION)
    if video_restored <= 0:
        raise RuntimeError(f"video duration column did not restore: {video_restored}")
    return {
        "video_before": video_before,
        "video_hidden": video_hidden,
        "image_visible": image_visible,
        "video_hidden_after_switch": video_hidden_after_switch,
        "video_restored": video_restored,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    args = parser.parse_args()

    exe = args.exe.resolve()
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    isolated = Path(tempfile.mkdtemp(prefix="mediova-round12-list-"))
    env = os.environ.copy()
    env["APPDATA"] = str(isolated)
    env["LOCALAPPDATA"] = str(isolated)
    process = subprocess.Popen([str(exe), "--ui-preview=video"], cwd=str(exe.parent), env=env)
    reader: RemoteHeaderReader | None = None
    try:
        main_hwnd = gate.find_window(process.pid, "Mediova", 20.0)
        if not gate.user32.MoveWindow(main_hwnd, 0, 0, 1650, 930, True):
            raise ctypes.WinError(ctypes.get_last_error())
        time.sleep(1.2)
        list_hwnd = int(gate.user32.GetDlgItem(main_hwnd, IDC_LIST))
        column_button = int(gate.user32.GetDlgItem(main_hwnd, IDC_COLUMN_SETTINGS))
        toggle_button = int(gate.user32.GetDlgItem(main_hwnd, IDC_RIGHT_TOGGLE))
        if not list_hwnd or not column_button or not toggle_button:
            raise RuntimeError("task list or list-layout buttons not found")
        column_button_info = child_by_handle(main_hwnd, column_button)
        toggle_button_info = child_by_handle(main_hwnd, toggle_button)
        if int(column_button_info["rect"][1]) >= int(toggle_button_info["rect"][1]):
            raise RuntimeError("column settings button is not above the relocated panel toggle")

        header = header_handle(main_hwnd)
        reader = RemoteHeaderReader(process.pid)
        captions = reader.titles(int(header["hwnd"]))
        if captions != EXPECTED_CAPTIONS:
            raise RuntimeError(f"unexpected captions: {captions!r}")

        list_info = child_by_handle(main_hwnd, list_hwnd)
        left_cells, screen_rows = read_relative_cells(reader, list_hwnd, len(captions), list_info)
        left_image = runner.capture_screen_rect(list_info["rect"])
        try:
            left_visual = validate_left_list_image(left_image, left_cells, evidence)
        finally:
            left_image.close()

        stable_unique_hashes = validate_selected_stability(screen_rows[0], evidence)

        # The list is deliberately wider than its viewport. Validate the right
        # half after a real ListView horizontal scroll instead of clamping
        # off-screen coordinates to the screenshot edge.
        gate.user32.SendMessageW(list_hwnd, LVM_SCROLL, 5000, 0)
        time.sleep(0.45)
        right_cells, _ = read_relative_cells(reader, list_hwnd, len(captions), list_info)
        right_image = runner.capture_screen_rect(list_info["rect"])
        try:
            right_visual = validate_right_list_image(right_image, right_cells, evidence)
        finally:
            right_image.close()

        selected_samples = merge_selected_samples(
            left_visual["selected_background_samples"],
            right_visual["selected_background_samples"],
            len(captions),
        )
        profile = validate_column_profiles(main_hwnd, list_hwnd)
        report = {
            "column_count": len(captions),
            "captions": captions,
            "selected_background_expected": list(EXPECTED_SELECTION),
            "selected_background_samples": selected_samples,
            "selected_white_text_pixels": left_visual["selected_white_text_pixels"],
            "preview_saturated_pixels": left_visual["preview_saturated_pixels"],
            "preview_unique_colors": left_visual["preview_unique_colors"],
            "time_crop_dark_pixels": right_visual["time_crop_dark_pixels"],
            "picture_crop_dark_pixels": right_visual["picture_crop_dark_pixels"],
            "horizontal_viewports_validated": 2,
            "stable_frames": 20,
            "stable_unique_hashes": stable_unique_hashes,
            "column_settings_button_rect": column_button_info["rect"],
            "right_toggle_button_rect": toggle_button_info["rect"],
            "column_profile_isolation": profile,
        }
        (evidence / "round12-list-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
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
