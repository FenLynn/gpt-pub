from __future__ import annotations

import hashlib
import time
from pathlib import Path

import round11_flicker_gate_runner_base as runner
from round12_list_gate_helpers import EXPECTED_SELECTION, close_color, dark_pixels, sample_background, saturated_pixels


def _require_fully_visible(image, cell: list[int], column: int) -> None:
    left, top, right, bottom = cell
    if left < 0 or top < 0 or right > image.width or bottom > image.height or right <= left or bottom <= top:
        raise RuntimeError(
            f"column={column} is not fully visible in captured viewport: cell={cell} image={image.width}x{image.height}"
        )


def validate_selected_columns(list_image, row_cells: list[list[int]], columns: list[int]) -> dict[int, list[int]]:
    samples: dict[int, list[int]] = {}
    for column in columns:
        cell = row_cells[column]
        _require_fully_visible(list_image, cell, column)
        sample = sample_background(list_image, cell)
        samples[column] = list(sample)
        if not close_color(sample, EXPECTED_SELECTION):
            raise RuntimeError(f"selected background mismatch column={column}: {sample}")
    return samples


def validate_left_list_image(list_image, relative_cells: list[list[list[int]]], evidence: Path) -> dict[str, object]:
    list_image.save(evidence / "round12-list-structure-left.png")
    selected_samples = validate_selected_columns(list_image, relative_cells[0], list(range(0, 8)))

    file_cell = relative_cells[0][2]
    _require_fully_visible(list_image, file_cell, 2)
    file_crop = list_image.crop(tuple(file_cell))
    try:
        white_text_pixels = sum(1 for red, green, blue in file_crop.convert("RGB").getdata() if red > 248 and green > 248 and blue > 248)
    finally:
        file_crop.close()
    if white_text_pixels > 10:
        raise RuntimeError(f"selected filename still uses white text: pixels={white_text_pixels}")

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

    return {
        "selected_background_samples": selected_samples,
        "selected_white_text_pixels": white_text_pixels,
        "preview_saturated_pixels": preview_saturated,
        "preview_unique_colors": preview_unique,
    }


def validate_right_list_image(list_image, relative_cells: list[list[list[int]]], evidence: Path) -> dict[str, object]:
    list_image.save(evidence / "round12-list-structure-right.png")
    selected_samples = validate_selected_columns(list_image, relative_cells[0], list(range(8, 15)))

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
        "selected_background_samples": selected_samples,
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
