from __future__ import annotations

import hashlib
import time
from pathlib import Path

import round11_flicker_gate_runner_base as runner
from round12_list_gate_helpers import (
    EXPECTED_STATUS_DONE,
    EXPECTED_STATUS_OTHER,
    EXPECTED_STATUS_PROCESSING,
    EXPECTED_STATUS_QUEUED,
    close_color,
    dark_pixels,
    sample_background,
    saturated_pixels,
)


def _require_fully_visible(image, cell: list[int], column: int) -> None:
    left, top, right, bottom = cell
    if left < 0 or top < 0 or right > image.width or bottom > image.height or right <= left or bottom <= top:
        raise RuntimeError(
            f"column={column} is not fully visible in captured viewport: cell={cell} image={image.width}x{image.height}"
        )


def validate_status_columns(
    list_image,
    row_cells: list[list[int]],
    columns: list[int],
    expected: tuple[int, int, int] = EXPECTED_STATUS_OTHER,
) -> dict[int, list[int]]:
    samples: dict[int, list[int]] = {}
    for column in columns:
        cell = row_cells[column]
        _require_fully_visible(list_image, cell, column)
        sample = sample_background(list_image, cell, expected)
        samples[column] = list(sample)
        if not close_color(sample, expected, tolerance=4):
            raise RuntimeError(f"status background mismatch column={column}: sample={sample} expected={expected}")
    return samples


def validate_left_list_image(list_image, relative_cells: list[list[list[int]]], evidence: Path) -> dict[str, object]:
    list_image.save(evidence / "round12-list-structure-left.png")
    status_samples = validate_status_columns(list_image, relative_cells[0], list(range(0, 7)))

    expected_rows = {
        0: EXPECTED_STATUS_OTHER,
        1: EXPECTED_STATUS_QUEUED,
        2: EXPECTED_STATUS_PROCESSING,
        5: EXPECTED_STATUS_DONE,
    }
    row_backgrounds: dict[int, list[int]] = {}
    row_tail_backgrounds: dict[int, list[int]] = {}
    for row, expected in expected_rows.items():
        visible_right = 0
        representative: tuple[int, int, int] | None = None
        for column, cell in enumerate(relative_cells[row]):
            left, top, right, bottom = [int(value) for value in cell]
            if right <= left or bottom <= top or left < 0 or right > list_image.width:
                continue
            sample = sample_background(list_image, cell, expected)
            if not close_color(sample, expected, tolerance=4):
                raise RuntimeError(
                    f"row status tint mismatch: row={row} column={column} sample={sample} expected={expected}"
                )
            representative = sample
            visible_right = max(visible_right, right)
        if representative is None:
            raise RuntimeError(f"row has no visible status-tint cells: row={row}")
        row_backgrounds[row] = list(representative)
        if visible_right + 6 < list_image.width:
            x = min(list_image.width - 2, visible_right + 12)
            y = (int(relative_cells[row][0][1]) + int(relative_cells[row][0][3])) // 2
            tail = tuple(int(value) for value in list_image.getpixel((x, y))[:3])
            if not close_color(tail, expected, tolerance=4):
                raise RuntimeError(
                    f"row tail tint mismatch: row={row} sample={tail} expected={expected} at=({x},{y})"
                )
            row_tail_backgrounds[row] = list(tail)

    number_dark_pixels: list[int] = []
    for row in range(min(3, len(relative_cells))):
        number_cell = relative_cells[row][0]
        _require_fully_visible(list_image, number_cell, 0)
        crop = list_image.crop(tuple(number_cell))
        try:
            value = dark_pixels(crop)
        finally:
            crop.close()
        number_dark_pixels.append(value)
        if value < 3:
            raise RuntimeError(f"row number is not visibly rendered: row={row} dark_pixels={value}")

    file_cell = relative_cells[0][2]
    _require_fully_visible(list_image, file_cell, 2)
    file_crop = list_image.crop(tuple(file_cell))
    try:
        filename_dark = dark_pixels(file_crop)
    finally:
        file_crop.close()
    if filename_dark < 24:
        raise RuntimeError(f"selected filename is not visibly dark: pixels={filename_dark}")

    preview_cell = relative_cells[0][1]
    _require_fully_visible(list_image, preview_cell, 1)
    margin_x = max(4, (preview_cell[2] - preview_cell[0] - 80) // 2)
    preview_crop = list_image.crop((preview_cell[0] + margin_x, preview_cell[1] + 4, preview_cell[2] - margin_x, preview_cell[3] - 4))
    try:
        preview_crop.save(evidence / "round12-preview-cell.png")
        preview_saturated = saturated_pixels(preview_crop)
        preview_unique = len(set(preview_crop.convert("RGB").getdata()))
    finally:
        preview_crop.close()
    if preview_saturated < 80 or preview_unique < 8:
        raise RuntimeError(f"preview column does not contain a thumbnail: saturated={preview_saturated} unique={preview_unique}")

    status_marker_colors = [
        (76, 96, 120),   # ready: ring
        (53, 104, 166),  # queued: three dots
        (126, 78, 190),  # processing: play
        (197, 126, 16),  # paused: two bars
        (172, 102, 31),  # held: diamond
        (35, 143, 79),   # done: circle
        (198, 67, 61),   # failed: cross
    ]
    status_marker_pixels: list[int] = []
    for row, expected in enumerate(status_marker_colors):
        status_cell = relative_cells[row][12]
        _require_fully_visible(list_image, status_cell, 12)
        marker = list_image.crop((status_cell[0], status_cell[1], min(status_cell[2], status_cell[0] + 24), status_cell[3]))
        try:
            marker = marker.convert("RGB")
            matching = sum(
                1
                for pixel in marker.getdata()
                if all(abs(int(pixel[channel]) - expected[channel]) <= 3 for channel in range(3))
            )
        finally:
            marker.close()
        status_marker_pixels.append(matching)
        if matching < 4:
            raise RuntimeError(
                f"status marker missing or wrong color: row={row} expected={expected} pixels={matching}"
            )

    return {
        "status_background_samples": status_samples,
        "status_row_backgrounds": row_backgrounds,
        "status_row_tail_backgrounds": row_tail_backgrounds,
        "number_dark_pixels": number_dark_pixels,
        "selected_filename_dark_pixels": filename_dark,
        "preview_saturated_pixels": preview_saturated,
        "preview_unique_colors": preview_unique,
        "status_marker_colors": [list(color) for color in status_marker_colors],
        "status_marker_pixels": status_marker_pixels,
    }


def validate_right_group_image(
    list_image,
    relative_cells: list[list[list[int]]],
    evidence: Path,
    columns: list[int],
    name: str,
) -> dict[int, list[int]]:
    list_image.save(evidence / f"round12-list-structure-{name}.png")
    return validate_status_columns(list_image, relative_cells[0], columns)


def validate_trim_cells(list_image, relative_cells: list[list[list[int]]], evidence: Path) -> dict[str, object]:
    time_cell = relative_cells[2][13]
    _require_fully_visible(list_image, time_cell, 13)
    time_crop = list_image.crop(tuple(time_cell))
    try:
        time_crop.save(evidence / "round12-time-crop-cell.png")
        middle = max(1, time_crop.height // 2)
        top_crop = time_crop.crop((0, 0, time_crop.width, middle))
        bottom_crop = time_crop.crop((0, middle, time_crop.width, time_crop.height))
        try:
            top_dark = dark_pixels(top_crop)
            bottom_dark = dark_pixels(bottom_crop)
        finally:
            top_crop.close()
            bottom_crop.close()
    finally:
        time_crop.close()
    if top_dark < 5 or bottom_dark < 5:
        raise RuntimeError(f"time crop is not rendered on two lines: top={top_dark} bottom={bottom_dark}")

    picture_cell = relative_cells[2][14]
    _require_fully_visible(list_image, picture_cell, 14)
    picture_crop = list_image.crop(tuple(picture_cell))
    try:
        picture_crop.save(evidence / "round12-picture-crop-cell.png")
        picture_dark = dark_pixels(picture_crop)
    finally:
        picture_crop.close()
    if picture_dark < 5:
        raise RuntimeError(f"picture crop percentage is not visible: dark={picture_dark}")

    return {
        "time_crop_dark_pixels": {"top": top_dark, "bottom": bottom_dark},
        "picture_crop_dark_pixels": picture_dark,
    }


def validate_selected_stability(screen_rect: list[int], evidence: Path) -> int:
    hashes: list[str] = []
    for frame in range(20):
        image = runner.capture_screen_rect(screen_rect)
        try:
            if frame in (0, 19):
                image.save(evidence / f"round12-selected-row-{frame:02d}.png")
            hashes.append(hashlib.sha256(image.tobytes()).hexdigest())
        finally:
            image.close()
        time.sleep(0.05)
    unique = len(set(hashes))
    if unique != 1:
        raise RuntimeError(f"selected row is visually unstable: {unique} hashes")
    return unique
