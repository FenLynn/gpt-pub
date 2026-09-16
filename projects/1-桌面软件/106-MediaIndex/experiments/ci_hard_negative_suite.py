from __future__ import annotations

import csv
import json
import math
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

import a004_real_image_acceptance_runner as image_runner


WIDTH = 960
HEIGHT = 720


def texture(seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    image = rng.integers(
        0,
        256,
        size=(HEIGHT, WIDTH, 3),
        dtype=np.uint8,
    )
    image = cv2.GaussianBlur(
        image,
        (0, 0),
        sigmaX=1.6,
        sigmaY=1.6,
    )

    yy, xx = np.mgrid[0:HEIGHT, 0:WIDTH]
    image[..., 0] = (
        0.55 * image[..., 0]
        + 0.45 * ((xx * 3 + yy * 2 + seed * 11) % 256)
    ).astype(np.uint8)
    image[..., 1] = (
        0.55 * image[..., 1]
        + 0.45 * ((yy * 5 + seed * 17) % 256)
    ).astype(np.uint8)
    image[..., 2] = (
        0.55 * image[..., 2]
        + 0.45 * (((xx + yy) * 2 + seed * 23) % 256)
    ).astype(np.uint8)
    return image


def shift_layer(
    image: np.ndarray,
    dx: int,
    dy: int,
) -> np.ndarray:
    matrix = np.float32(
        [
            [1.0, 0.0, dx],
            [0.0, 1.0, dy],
        ]
    )
    return cv2.warpAffine(
        image,
        matrix,
        (WIDTH, HEIGHT),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT,
    )


def parallax_scene(view: int) -> np.ndarray:
    background = texture(210)
    mid = np.zeros_like(background)
    foreground = np.zeros_like(background)

    for row in range(5):
        for col in range(7):
            x = 65 + col * 125
            y = 70 + row * 125
            color = (
                40 + (row * 39) % 190,
                50 + (col * 31) % 180,
                70 + ((row + col) * 29) % 170,
            )
            cv2.circle(
                mid,
                (x, y),
                34 + (row + col) % 18,
                color,
                -1,
            )
            cv2.putText(
                mid,
                f"{row}{col}",
                (x - 24, y + 8),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (245, 245, 245),
                2,
                cv2.LINE_AA,
            )

    for index in range(6):
        x1 = 80 + index * 140
        y1 = 180 + (index % 2) * 210
        cv2.rectangle(
            foreground,
            (x1, y1),
            (min(WIDTH - 20, x1 + 115),
             min(HEIGHT - 20, y1 + 180)),
            (
                230 - index * 18,
                80 + index * 21,
                55 + index * 16,
            ),
            -1,
        )

    if view == 0:
        bg = shift_layer(background, -8, 0)
        md = shift_layer(mid, -22, 2)
        fg = shift_layer(foreground, -48, 4)
    else:
        bg = shift_layer(background, 10, 0)
        md = shift_layer(mid, 28, -2)
        fg = shift_layer(foreground, 55, -5)

    mask_mid = np.any(md != 0, axis=2)
    mask_fg = np.any(fg != 0, axis=2)

    output = bg.copy()
    output[mask_mid] = md[mask_mid]
    output[mask_fg] = fg[mask_fg]

    cv2.putText(
        output,
        "SAME SCENE / DIFFERENT CAMERA",
        (80, 50),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.85,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    return output


def poster(version: int) -> np.ndarray:
    canvas = np.full(
        (HEIGHT, WIDTH, 3),
        232,
        dtype=np.uint8,
    )
    cv2.rectangle(
        canvas,
        (55, 45),
        (WIDTH - 55, HEIGHT - 45),
        (32, 32, 32),
        8,
    )

    for x in range(100, WIDTH - 100, 95):
        cv2.circle(
            canvas,
            (x, 110),
            18,
            (60, 110, 190),
            -1,
        )

    cv2.putText(
        canvas,
        "MEDIA INDEX CONFERENCE",
        (115, 185),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.15,
        (35, 35, 35),
        3,
        cv2.LINE_AA,
    )

    if version == 0:
        center = texture(311)
        label = "SESSION A"
    else:
        center = texture(509)
        label = "SESSION B"

    center = cv2.resize(
        center,
        (600, 330),
        interpolation=cv2.INTER_AREA,
    )
    canvas[240:570, 180:780] = center

    cv2.putText(
        canvas,
        label,
        (325, 650),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.25,
        (25, 25, 25),
        3,
        cv2.LINE_AA,
    )
    return canvas


def repeated_pattern(phase: int) -> np.ndarray:
    image = np.full(
        (HEIGHT, WIDTH, 3),
        245,
        dtype=np.uint8,
    )
    step = 72

    for y in range(-step, HEIGHT + step, step):
        for x in range(-step, WIDTH + step, step):
            xx = x + phase
            yy = y + phase // 2
            cv2.rectangle(
                image,
                (xx, yy),
                (xx + 38, yy + 38),
                (45, 75, 130),
                -1,
            )
            cv2.circle(
                image,
                (xx + 42, yy + 42),
                12,
                (190, 85, 55),
                -1,
            )

    cv2.putText(
        image,
        f"PATTERN {phase}",
        (330, HEIGHT - 55),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.0,
        (20, 20, 20),
        3,
        cv2.LINE_AA,
    )
    return image


def low_texture(version: int) -> np.ndarray:
    yy, xx = np.mgrid[0:HEIGHT, 0:WIDTH]
    image = np.empty(
        (HEIGHT, WIDTH, 3),
        dtype=np.uint8,
    )

    base = (
        110
        + 45 * np.sin(xx / 190.0)
        + 35 * np.cos(yy / 150.0)
    )
    image[..., 0] = np.clip(base + 12, 0, 255)
    image[..., 1] = np.clip(base + 28, 0, 255)
    image[..., 2] = np.clip(base + 45, 0, 255)

    center = (
        360 if version == 0 else 600,
        360,
    )
    cv2.circle(
        image,
        center,
        68,
        (180, 155, 130),
        -1,
    )
    return image


def write_jpeg(path: Path, image: np.ndarray) -> None:
    ok, encoded = cv2.imencode(
        ".jpg",
        image,
        [cv2.IMWRITE_JPEG_QUALITY, 92],
    )
    if not ok:
        raise RuntimeError("JPEG encoding failed")
    encoded.tofile(str(path))


def run_module(module, argv: list[str]) -> None:
    original = sys.argv[:]
    try:
        sys.argv = [original[0], *argv]
        module.main()
    finally:
        sys.argv = original


def main() -> None:
    with tempfile.TemporaryDirectory(
        prefix="p106-hard-negative-"
    ) as temp:
        root = Path(temp)
        library = root / "library"
        query = root / "query"
        library.mkdir()
        query.mkdir()

        library_cases = {
            "parallax_view_a.jpg": parallax_scene(0),
            "poster_a.jpg": poster(0),
            "pattern_a.jpg": repeated_pattern(0),
            "low_texture_a.jpg": low_texture(0),
        }

        query_cases = {
            "parallax_view_b.jpg": parallax_scene(1),
            "poster_b.jpg": poster(1),
            "pattern_b.jpg": repeated_pattern(27),
            "low_texture_b.jpg": low_texture(1),
        }

        # Distractors make the candidate ranking non-trivial.
        for seed in range(6):
            library_cases[
                f"distractor_{seed:02d}.jpg"
            ] = texture(700 + seed)

        for name, image in library_cases.items():
            write_jpeg(
                library / name,
                image,
            )

        rows = []
        for name, image in query_cases.items():
            path = query / name
            write_jpeg(path, image)
            rows.append(
                {
                    "query": str(path),
                    "expected_source": "",
                    "relation": "Known hard negative",
                }
            )

        manifest = root / "manifest.csv"
        with manifest.open(
            "w",
            encoding="utf-8-sig",
            newline="",
        ) as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=[
                    "query",
                    "expected_source",
                    "relation",
                ],
            )
            writer.writeheader()
            writer.writerows(rows)

        output = root / "results.json"

        run_module(
            image_runner,
            [
                "--library", str(library),
                "--manifest", str(manifest),
                "--topk", "10",
                "--output", str(output),
            ],
        )

        data = json.loads(
            output.read_text(encoding="utf-8")
        )

        summary = data["summary"]

        if int(
            summary[
                "false_confirmed_count_baseline"
            ]
        ) != 0:
            raise AssertionError(
                json.dumps(
                    data,
                    ensure_ascii=False,
                    indent=2,
                )
            )

        stress = []

        for row in data["results"]:
            top = (
                row["top_candidates"][0]
                if row["top_candidates"]
                else {}
            )
            stress.append(
                {
                    "query": row["query_name"],
                    "top_source": row["top1_source"],
                    "confirmed": top.get(
                        "confirmed_baseline"
                    ),
                    "inliers": top.get("inliers"),
                    "ratio": top.get("ratio"),
                    "ncc": top.get("ncc"),
                    "template_score": top.get(
                        "template_score"
                    ),
                    "ranking_mode": row.get(
                        "ranking_mode"
                    ),
                }
            )

        print(
            json.dumps(
                {
                    "ok": True,
                    "known_hard_negatives": len(rows),
                    "false_confirmed": 0,
                    "stress": stress,
                },
                ensure_ascii=False,
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
