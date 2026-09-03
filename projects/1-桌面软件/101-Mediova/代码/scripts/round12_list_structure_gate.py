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
    IDC_COLUMN_SETTINGS,
    IDC_LIST,
    IDC_RIGHT_TOGGLE,
    IDC_TAB_IMAGE,
    IDC_TAB_VIDEO,
    ROUND12_COLUMN_MENU_BASE,
    TASK_COL_DURATION,
    client_rect_to_screen,
    column_width,
    dark_pixels,
    send_command,
)
from round12_list_gate_visual import (
    validate_left_list_image,
    validate_right_group_image,
    validate_selected_stability,
    validate_trim_cells,
)
from round12_remote_header import EXPECTED_CAPTIONS, RemoteHeaderReader, header_handle

LVM_SETCOLUMNWIDTH = 0x1000 + 30
WM_MOUSEMOVE = 0x0200
WM_LBUTTONDOWN = 0x0201
WM_LBUTTONUP = 0x0202
MK_LBUTTON = 0x0001
HWND_TOPMOST = -1
SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOACTIVATE = 0x0010

gate.user32.SetWindowPos.argtypes = [
    wintypes.HWND,
    wintypes.HWND,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    wintypes.UINT,
]
gate.user32.SetWindowPos.restype = wintypes.BOOL


def child_by_handle(main_hwnd: int, handle: int) -> dict[str, object]:
    return next(child for child in gate.enumerate_children(main_hwnd) if int(child["hwnd"]) == handle)


def read_relative_cells(
    reader: RemoteHeaderReader,
    list_hwnd: int,
    column_count: int,
    list_info: dict[str, object],
    row_count: int = 3,
) -> tuple[list[list[list[int]]], list[list[int]]]:
    row_rects = [reader.list_item_rect(list_hwnd, row) for row in range(row_count)]
    subitems = [[reader.list_subitem_rect(list_hwnd, row, column) for column in range(column_count)] for row in range(row_count)]

    # Win32 ListView treats subitem 0 specially: LVM_GETSUBITEMRECT with
    # LVIR_BOUNDS returns the entire row width. Normalize it to the actual
    # first-column width so viewport checks validate the # cell, not the row.
    first_width = column_width(list_hwnd, 0)
    if first_width <= 0:
        raise RuntimeError(f"first column has invalid width: {first_width}")
    for row in subitems:
        row[0][2] = row[0][0] + first_width

    screen_rows = [client_rect_to_screen(list_hwnd, value) for value in row_rects]
    screen_cells = [[client_rect_to_screen(list_hwnd, value) for value in row] for row in subitems]
    origin_x, origin_y = int(list_info["rect"][0]), int(list_info["rect"][1])
    relative_cells = [
        [[cell[0] - origin_x, cell[1] - origin_y, cell[2] - origin_x, cell[3] - origin_y] for cell in row]
        for row in screen_cells
    ]
    return relative_cells, screen_rows


def merge_selected_samples(parts: list[dict[int, list[int]]], count: int) -> list[list[int]]:
    merged: dict[int, list[int]] = {}
    for part in parts:
        merged.update(part)
    missing = [column for column in range(count) if column not in merged]
    if missing:
        raise RuntimeError(f"selected background columns were not all sampled: missing={missing}")
    return [merged[column] for column in range(count)]


def set_columns_visible(main_hwnd: int, list_hwnd: int, columns: list[int], visible: bool) -> None:
    for column in columns:
        is_visible = column_width(list_hwnd, column) > 0
        if is_visible != visible:
            send_command(main_hwnd, ROUND12_COLUMN_MENU_BASE + column)
            time.sleep(0.10)
        now_visible = column_width(list_hwnd, column) > 0
        if now_visible != visible:
            raise RuntimeError(f"column visibility transition failed: column={column} expected={visible} actual={now_visible}")


def validate_hidden_columns_reject_width_drift(
    list_hwnd: int, header_hwnd: int, reader: RemoteHeaderReader
) -> dict[str, object]:
    hidden_columns = [14, 15]
    before = [column_width(list_hwnd, column) for column in hidden_columns]
    if before != [0, 0]:
        raise RuntimeError(f"hidden trim columns unexpectedly visible before drift test: {before}")
    for column, attempted_width in zip(hidden_columns, [118, 92]):
        gate.user32.SendMessageW(list_hwnd, LVM_SETCOLUMNWIDTH, column, attempted_width)
    time.sleep(0.15)
    after = [column_width(list_hwnd, column) for column in hidden_columns]
    if after != [0, 0]:
        raise RuntimeError(f"unchecked columns accepted nonzero width drift: before={before} after={after}")

    # Reproduce the actual bug: all hidden zero-width dividers overlap the
    # right edge of the final visible Status column. Native Header dragging at
    # that exact edge used to pull Picture Crop out to a visible width while
    # the menu remained unchecked.
    rects = reader.rects(header_hwnd)
    status_right = int(rects[13][2])
    y = max(4, (int(rects[13][1]) + int(rects[13][3])) // 2)

    def point(x: int) -> int:
        return ((y & 0xFFFF) << 16) | (x & 0xFFFF)

    gate.user32.SendMessageW(header_hwnd, WM_LBUTTONDOWN, MK_LBUTTON, point(status_right))
    gate.user32.SendMessageW(header_hwnd, WM_MOUSEMOVE, MK_LBUTTON, point(status_right + 100))
    gate.user32.SendMessageW(header_hwnd, WM_LBUTTONUP, 0, point(status_right + 100))
    time.sleep(0.15)
    after_header_drag = [column_width(list_hwnd, column) for column in hidden_columns]
    if after_header_drag != [0, 0]:
        raise RuntimeError(
            f"real Header drag exposed unchecked columns: before={before} after={after_header_drag}"
        )
    return {
        "columns": hidden_columns,
        "before": before,
        "after_external_width_request": after,
        "after_real_header_drag": after_header_drag,
    }


def columns_fully_visible(cells: list[list[list[int]]], image_width: int, columns: list[int]) -> bool:
    for column in columns:
        left, top, right, bottom = cells[0][column]
        if left < 0 or top < 0 or right > image_width or bottom <= top or right <= left:
            return False
    return True


def prepare_group_view(
    main_hwnd: int,
    list_hwnd: int,
    reader: RemoteHeaderReader,
    column_count: int,
    list_info: dict[str, object],
    visible_group: list[int],
    hidden_group: list[int],
) -> list[list[list[int]]]:
    set_columns_visible(main_hwnd, list_hwnd, [3, 4, 5, 6], False)
    set_columns_visible(main_hwnd, list_hwnd, hidden_group, False)
    set_columns_visible(main_hwnd, list_hwnd, visible_group, True)
    time.sleep(0.30)
    cells, _ = read_relative_cells(reader, list_hwnd, column_count, list_info)
    viewport_width = int(list_info["rect"][2]) - int(list_info["rect"][0])
    if not columns_fully_visible(cells, viewport_width, visible_group):
        raise RuntimeError(
            f"column group is not fully visible after real column toggles: group={visible_group} viewport={viewport_width} cells={[cells[0][c] for c in visible_group]}"
        )
    return cells


def restore_default_columns(main_hwnd: int, list_hwnd: int) -> None:
    set_columns_visible(main_hwnd, list_hwnd, list(range(3, 15)), True)


def validate_column_profiles(main_hwnd: int, list_hwnd: int) -> dict[str, int]:
    # Both media kinds now start from the compact core set. Establish an
    # explicit image-only choice before proving that the video profile does
    # not leak across the kind switch.
    send_command(main_hwnd, IDC_TAB_IMAGE)
    time.sleep(0.25)
    if column_width(list_hwnd, TASK_COL_DURATION) <= 0:
        send_command(main_hwnd, ROUND12_COLUMN_MENU_BASE + TASK_COL_DURATION)
    image_before = column_width(list_hwnd, TASK_COL_DURATION)
    if image_before <= 0:
        raise RuntimeError(f"image duration column could not be enabled: {image_before}")
    send_command(main_hwnd, IDC_TAB_VIDEO)
    time.sleep(0.25)

    video_before = column_width(list_hwnd, TASK_COL_DURATION)
    if video_before <= 0:
        raise RuntimeError(f"video duration column unexpectedly hidden before toggle: {video_before}")
    send_command(main_hwnd, ROUND12_COLUMN_MENU_BASE + TASK_COL_DURATION)
    video_hidden = column_width(list_hwnd, TASK_COL_DURATION)
    if video_hidden != 0:
        raise RuntimeError(f"video duration column did not hide: {video_hidden}")
    send_command(main_hwnd, IDC_TAB_IMAGE)
    time.sleep(0.25)
    image_visible = column_width(list_hwnd, TASK_COL_DURATION)
    if image_visible <= 0:
        raise RuntimeError(f"image column profile leaked hidden video duration: {image_visible}")
    send_command(main_hwnd, IDC_TAB_VIDEO)
    time.sleep(0.25)
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
        "image_before": image_before,
        "image_visible": image_visible,
        "video_hidden_after_switch": video_hidden_after_switch,
        "video_restored": video_restored,
    }


def validate_hidden_picture_crop_has_no_residue(
    main_hwnd: int,
    list_hwnd: int,
    reader: RemoteHeaderReader,
    column_count: int,
    list_info: dict[str, object],
    evidence: Path,
) -> int:
    set_columns_visible(main_hwnd, list_hwnd, [14], False)
    time.sleep(0.30)
    cells, _ = read_relative_cells(reader, list_hwnd, column_count, list_info)
    image = runner.capture_screen_rect(list_info["rect"])
    try:
        image.save(evidence / "round12-hidden-picture-crop.png")
        last_right = int(cells[0][13][2])
        row_top = max(0, int(cells[0][13][1]) + 2)
        row_bottom = min(image.height, int(cells[2][13][3]) - 2)
        trail_left = min(image.width, max(0, last_right + 2))
        trail_right = min(image.width, trail_left + 90)
        if trail_right - trail_left < 12 or row_bottom <= row_top:
            raise RuntimeError(
                f"hidden picture-crop residue viewport invalid: x={trail_left}:{trail_right} y={row_top}:{row_bottom} image={image.width}x{image.height}"
            )
        crop = image.crop((trail_left, row_top, trail_right, row_bottom))
        try:
            crop.save(evidence / "round12-hidden-picture-crop-tail.png")
            residue_dark = dark_pixels(crop)
        finally:
            crop.close()
    finally:
        image.close()
    if residue_dark > 8:
        raise RuntimeError(f"hidden picture-crop column still paints visible residue: dark_pixels={residue_dark}")
    set_columns_visible(main_hwnd, list_hwnd, [14], True)
    return residue_dark


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
        if not gate.user32.SetWindowPos(
            main_hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
        ):
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
        hidden_width_authority = validate_hidden_columns_reject_width_drift(
            list_hwnd, int(header["hwnd"]), reader
        )

        list_info = child_by_handle(main_hwnd, list_hwnd)
        left_cells, screen_rows = read_relative_cells(reader, list_hwnd, len(captions), list_info, row_count=7)
        header_bottom = int(header["rect"][3])
        first_row_top = int(screen_rows[0][1])
        if first_row_top < header_bottom:
            raise RuntimeError(f"first data row overlaps Header: row_top={first_row_top} header_bottom={header_bottom}")

        left_image = runner.capture_screen_rect(list_info["rect"])
        try:
            left_visual = validate_left_list_image(left_image, left_cells, evidence)
        finally:
            left_image.close()

        stable_unique_hashes = validate_selected_stability(screen_rows[0], evidence)

        initial_list_width = int(list_info["rect"][2]) - int(list_info["rect"][0])
        send_command(main_hwnd, IDC_RIGHT_TOGGLE)
        time.sleep(0.45)
        list_info = child_by_handle(main_hwnd, list_hwnd)
        collapsed_list_width = int(list_info["rect"][2]) - int(list_info["rect"][0])
        if collapsed_list_width <= initial_list_width:
            raise RuntimeError(f"right panel collapse did not widen task list: before={initial_list_width} after={collapsed_list_width}")

        group_a = [7, 8, 9, 10]
        group_b = [11, 12, 13, 14]
        group_a_cells = prepare_group_view(main_hwnd, list_hwnd, reader, len(captions), list_info, group_a, group_b)
        group_a_image = runner.capture_screen_rect(list_info["rect"])
        try:
            group_a_samples = validate_right_group_image(group_a_image, group_a_cells, evidence, group_a, "right-a")
        finally:
            group_a_image.close()

        group_b_cells = prepare_group_view(main_hwnd, list_hwnd, reader, len(captions), list_info, group_b, group_a)
        group_b_image = runner.capture_screen_rect(list_info["rect"])
        try:
            group_b_samples = validate_right_group_image(group_b_image, group_b_cells, evidence, group_b, "right-b")
            trim_visual = validate_trim_cells(group_b_image, group_b_cells, evidence)
        finally:
            group_b_image.close()

        hidden_picture_crop_residue = validate_hidden_picture_crop_has_no_residue(
            main_hwnd, list_hwnd, reader, len(captions), list_info, evidence
        )

        selected_samples = merge_selected_samples(
            [left_visual["status_background_samples"], group_a_samples, group_b_samples],
            len(captions),
        )

        restore_default_columns(main_hwnd, list_hwnd)
        profile = validate_column_profiles(main_hwnd, list_hwnd)
        report = {
            "column_count": len(captions),
            "captions": captions,
            "selected_row_preserves_status_background": True,
            "selected_row_background_expected": list(EXPECTED_STATUS_OTHER),
            "selected_row_background_samples": selected_samples,
            "status_row_backgrounds": left_visual["status_row_backgrounds"],
            "status_row_tail_backgrounds": left_visual["status_row_tail_backgrounds"],
            "number_dark_pixels": left_visual["number_dark_pixels"],
            "selected_filename_dark_pixels": left_visual["selected_filename_dark_pixels"],
            "preview_saturated_pixels": left_visual["preview_saturated_pixels"],
            "preview_unique_colors": left_visual["preview_unique_colors"],
            "status_marker_colors": left_visual["status_marker_colors"],
            "status_marker_pixels": left_visual["status_marker_pixels"],
            "first_row_top": first_row_top,
            "header_bottom": header_bottom,
            "header_row_overlap": False,
            "hidden_picture_crop_residue_dark_pixels": hidden_picture_crop_residue,
            "time_crop_dark_pixels": trim_visual["time_crop_dark_pixels"],
            "picture_crop_dark_pixels": trim_visual["picture_crop_dark_pixels"],
            "horizontal_viewports_validated": 3,
            "all_selected_columns_fully_visible": True,
            "right_panel_collapsed_for_full_view": True,
            "initial_list_width": initial_list_width,
            "collapsed_list_width": collapsed_list_width,
            "right_view_groups": [group_a, group_b],
            "stable_frames": 20,
            "stable_unique_hashes": stable_unique_hashes,
            "column_settings_button_rect": column_button_info["rect"],
            "right_toggle_button_rect": toggle_button_info["rect"],
            "column_profile_isolation": profile,
            "unchecked_columns_stay_hidden": hidden_width_authority,
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
