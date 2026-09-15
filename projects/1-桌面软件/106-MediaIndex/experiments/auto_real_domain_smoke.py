from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import shutil
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
import pillow_heif

import a004_real_image_acceptance_runner as image_runner
import v011_real_video_acceptance_runner as video_runner


pillow_heif.register_heif_opener()

IMAGE_EXTS = {
    ".jpg", ".jpeg", ".png", ".webp", ".bmp",
    ".tif", ".tiff", ".heic", ".heif",
}
VIDEO_EXTS = {
    ".mp4", ".mkv", ".mov", ".avi", ".webm",
    ".m4v", ".ts", ".mts", ".m2ts",
}


def stable_rank(path: Path) -> str:
    return hashlib.sha256(str(path).encode("utf-8")).hexdigest()


def load_image(path: Path) -> np.ndarray:
    if path.suffix.lower() in {".heic", ".heif"}:
        with Image.open(path) as source:
            rgb = np.asarray(source.convert("RGB"))
        return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

    data = np.fromfile(str(path), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Cannot decode image: {path}")
    return image


def save_jpeg(path: Path, image: np.ndarray, quality: int = 82) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ok, encoded = cv2.imencode(
        ".jpg",
        image,
        [cv2.IMWRITE_JPEG_QUALITY, quality],
    )
    if not ok:
        raise RuntimeError(f"JPEG encode failed: {path}")
    encoded.tofile(str(path))


def image_variants(image: np.ndarray) -> list[tuple[str, np.ndarray]]:
    height, width = image.shape[:2]
    variants: list[tuple[str, np.ndarray]] = []

    ok, encoded = cv2.imencode(
        ".jpg",
        image,
        [cv2.IMWRITE_JPEG_QUALITY, 30],
    )
    if ok:
        variants.append(
            (
                "recompress",
                cv2.imdecode(encoded, cv2.IMREAD_COLOR),
            )
        )

    small = cv2.resize(
        image,
        (
            max(32, width // 2),
            max(32, height // 2),
        ),
        interpolation=cv2.INTER_AREA,
    )
    variants.append(
        (
            "resize50",
            cv2.resize(
                small,
                (width, height),
                interpolation=cv2.INTER_CUBIC,
            ),
        )
    )

    x = int(width * 0.15)
    y = int(height * 0.15)
    if width - 2 * x >= 32 and height - 2 * y >= 32:
        crop = image[y:height-y, x:width-x]
        variants.append(
            (
                "crop30",
                cv2.resize(
                    crop,
                    (width, height),
                    interpolation=cv2.INTER_CUBIC,
                ),
            )
        )

    x1 = int(width * 0.30)
    x2 = int(width * 0.90)
    y1 = int(height * 0.08)
    y2 = int(height * 0.82)
    if x2 - x1 >= 32 and y2 - y1 >= 32:
        crop = image[y1:y2, x1:x2]
        variants.append(
            (
                "asym_crop",
                cv2.resize(
                    crop,
                    (width, height),
                    interpolation=cv2.INTER_CUBIC,
                ),
            )
        )

    overlay = image.copy()
    box_left = int(width * 0.54)
    box_top = int(height * 0.72)
    cv2.rectangle(
        overlay,
        (box_left, box_top),
        (max(box_left + 1, int(width * 0.96)),
         max(box_top + 1, int(height * 0.94))),
        (22, 22, 22),
        -1,
    )
    cv2.putText(
        overlay,
        "MEDIAINDEX TEST",
        (max(5, int(width * 0.58)), max(22, int(height * 0.85))),
        cv2.FONT_HERSHEY_SIMPLEX,
        max(0.45, min(width, height) / 900.0),
        (245, 245, 245),
        2,
        cv2.LINE_AA,
    )
    variants.append(("watermark", overlay))

    return variants


def safe_relative(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def build_image_smoke(
    library_root: Path,
    work_root: Path,
    max_images: int,
) -> tuple[Path | None, int]:
    candidates = sorted(
        [
            path
            for path in library_root.rglob("*")
            if path.is_file()
            and path.suffix.lower() in IMAGE_EXTS
        ],
        key=stable_rank,
    )

    if not candidates:
        return None, 0

    selected = candidates[:max_images]
    query_root = work_root / "auto_queries" / "images"
    rows = []
    generated = 0

    for source_index, source in enumerate(selected):
        try:
            image = load_image(source)
        except Exception as exc:
            print(f"SKIP image {source.name}: {exc}")
            continue

        if min(image.shape[:2]) < 64:
            print(f"SKIP tiny image {source.name}")
            continue

        for variant_name, variant in image_variants(image):
            query = query_root / (
                f"img_{source_index:03d}_{variant_name}.jpg"
            )
            save_jpeg(query, variant)
            rows.append(
                {
                    "query": str(query),
                    "expected_source": safe_relative(
                        source,
                        library_root,
                    ),
                    "relation": variant_name,
                }
            )
            generated += 1

    manifest = work_root / "auto_image_manifest.csv"
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

    return manifest, generated


def video_info(path: Path) -> tuple[float, float, int, int]:
    capture = cv2.VideoCapture(str(path))
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    frames = float(
        capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    )
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    capture.release()
    duration = frames / fps if fps > 0 else 0.0
    return duration, fps, width, height


def make_video_clip(
    source: Path,
    output: Path,
    start: float,
    duration: float,
    visual_mode: str,
) -> bool:
    capture = cv2.VideoCapture(str(source))
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)

    if fps <= 0 or width < 64 or height < 64:
        capture.release()
        return False

    output.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(
        str(output),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (640, 360),
    )
    if not writer.isOpened():
        capture.release()
        return False

    capture.set(
        cv2.CAP_PROP_POS_MSEC,
        start * 1000.0,
    )

    max_frames = int(duration * fps)
    written = 0

    for _ in range(max_frames):
        ok, frame = capture.read()
        if not ok:
            break

        if visual_mode == "plain":
            transformed = frame

        elif visual_mode == "watermark":
            transformed = frame.copy()
            h, w = transformed.shape[:2]
            cv2.rectangle(
                transformed,
                (int(w * 0.58), int(h * 0.76)),
                (int(w * 0.96), int(h * 0.94)),
                (15, 15, 15),
                -1,
            )

        elif visual_mode == "crop10":
            h, w = frame.shape[:2]
            x = int(w * 0.05)
            y = int(h * 0.05)
            transformed = frame[
                y:h-y,
                x:w-x,
            ]
        else:
            transformed = frame

        transformed = cv2.resize(
            transformed,
            (640, 360),
            interpolation=cv2.INTER_AREA,
        )
        writer.write(transformed)
        written += 1

    capture.release()
    writer.release()

    return written >= max(2, int(min(3.0, duration) * fps * 0.8))


def build_video_smoke(
    library_root: Path,
    work_root: Path,
    max_videos: int,
) -> tuple[Path | None, int]:
    candidates = sorted(
        [
            path
            for path in library_root.rglob("*")
            if path.is_file()
            and path.suffix.lower() in VIDEO_EXTS
        ],
        key=stable_rank,
    )

    if not candidates:
        return None, 0

    query_root = work_root / "auto_queries" / "videos"
    rows = []
    generated = 0

    for source_index, source in enumerate(candidates[:max_videos]):
        duration, fps, width, height = video_info(source)
        if duration < 5 or fps <= 0 or width < 64 or height < 64:
            print(f"SKIP short/unreadable video {source.name}")
            continue

        clip_duration = min(8.0, max(4.0, duration * 0.35))
        latest_start = max(0.0, duration - clip_duration - 0.5)
        start = min(
            latest_start,
            max(0.0, duration * 0.28),
        )

        for mode in ("plain", "watermark", "crop10"):
            query = query_root / (
                f"video_{source_index:03d}_{mode}.mp4"
            )

            if not make_video_clip(
                source,
                query,
                start,
                clip_duration,
                mode,
            ):
                continue

            rows.append(
                {
                    "query": str(query),
                    "expected_source": safe_relative(
                        source,
                        library_root,
                    ),
                    "relation": (
                        "Partial clip"
                        if mode == "plain"
                        else f"Partial clip + {mode}"
                    ),
                    "expected_start_sec": f"{start:.3f}",
                }
            )
            generated += 1

    manifest = work_root / "auto_video_manifest.csv"
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
                "expected_start_sec",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)

    return manifest, generated


def run_module(module, argv: list[str]) -> None:
    original = sys.argv[:]
    try:
        sys.argv = [original[0], *argv]
        module.main()
    finally:
        sys.argv = original


def summarize(
    work_root: Path,
    image_count: int,
    video_count: int,
) -> Path:
    image_path = work_root / "auto_a004_results.json"
    video_path = work_root / "auto_v011_results.json"

    image_summary = None
    video_summary = None

    if image_path.exists():
        image_summary = json.loads(
            image_path.read_text(encoding="utf-8")
        )["summary"]

    if video_path.exists():
        video_summary = json.loads(
            video_path.read_text(encoding="utf-8")
        )["summary"]

    summary = {
        "mode": "automatic-real-media-smoke",
        "generated_image_queries": image_count,
        "generated_video_queries": video_count,
        "image": image_summary,
        "video": video_summary,
        "privacy": {
            "source_media_copied": False,
            "generated_queries_are_temporary": True,
            "original_absolute_paths_exported": False,
        },
        "interpretation": (
            "Automatically generated positive transformations from "
            "real inventory. This smoke test does not replace manual "
            "same-scene hard negatives."
        ),
    }

    output = work_root / "auto_smoke_summary.json"
    output.write_text(
        json.dumps(
            summary,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return output


def main() -> None:
    parser = argparse.ArgumentParser(
        description="P106 automatic real-media smoke acceptance"
    )
    parser.add_argument("--image-library", default="")
    parser.add_argument("--video-library", default="")
    parser.add_argument("--workdir", required=True)
    parser.add_argument("--max-images", type=int, default=8)
    parser.add_argument("--max-videos", type=int, default=4)
    args = parser.parse_args()

    work_root = Path(args.workdir).resolve()
    if work_root.exists():
        shutil.rmtree(work_root)
    work_root.mkdir(parents=True, exist_ok=True)

    image_count = 0
    video_count = 0

    if args.image_library:
        image_library = Path(args.image_library).resolve()
        image_manifest, image_count = build_image_smoke(
            image_library,
            work_root,
            max(1, args.max_images),
        )

        if image_manifest is not None and image_count > 0:
            run_module(
                image_runner,
                [
                    "--library", str(image_library),
                    "--manifest", str(image_manifest),
                    "--topk", "50",
                    "--output", str(
                        work_root / "auto_a004_results.json"
                    ),
                ],
            )

    if args.video_library:
        video_library = Path(args.video_library).resolve()
        video_manifest, video_count = build_video_smoke(
            video_library,
            work_root,
            max(1, args.max_videos),
        )

        if video_manifest is not None and video_count > 0:
            run_module(
                video_runner,
                [
                    "--library", str(video_library),
                    "--manifest", str(video_manifest),
                    "--interval", "1.0",
                    "--output", str(
                        work_root / "auto_v011_results.json"
                    ),
                ],
            )

    summary = summarize(
        work_root,
        image_count,
        video_count,
    )
    print(summary.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
