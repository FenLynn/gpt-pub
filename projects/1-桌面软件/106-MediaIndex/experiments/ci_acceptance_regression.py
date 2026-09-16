from __future__ import annotations

import csv
import json
import math
import shutil
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

import a004_real_image_acceptance_runner as image_runner
import auto_real_domain_smoke as auto_runner
import v011_real_video_acceptance_runner as video_runner


RNG = np.random.default_rng(106)


def rich_image(seed: int, width: int = 960, height: int = 720) -> np.ndarray:
    rng = np.random.default_rng(seed)
    image = np.zeros((height, width, 3), dtype=np.uint8)

    yy, xx = np.mgrid[0:height, 0:width]
    image[..., 0] = ((xx * (seed + 3) + yy * 2) % 256).astype(np.uint8)
    image[..., 1] = ((yy * (seed + 5) + xx // 2) % 256).astype(np.uint8)
    image[..., 2] = (((xx + yy) * (seed + 7)) % 256).astype(np.uint8)

    for i in range(45):
        x1 = int(rng.integers(0, width - 80))
        y1 = int(rng.integers(0, height - 80))
        x2 = min(width - 1, x1 + int(rng.integers(30, 180)))
        y2 = min(height - 1, y1 + int(rng.integers(30, 180)))
        color = tuple(int(v) for v in rng.integers(20, 240, size=3))
        if i % 3 == 0:
            cv2.rectangle(image, (x1, y1), (x2, y2), color, -1)
        elif i % 3 == 1:
            radius = max(8, min(x2 - x1, y2 - y1) // 2)
            cv2.circle(image, (x1 + radius, y1 + radius), radius, color, -1)
        else:
            cv2.line(image, (x1, y1), (x2, y2), color, int(rng.integers(2, 8)))

    cv2.putText(
        image,
        f"MEDIAINDEX-{seed:02d}",
        (45, height - 65),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.5,
        (245, 245, 245),
        3,
        cv2.LINE_AA,
    )
    return image


def save_jpeg(path: Path, image: np.ndarray, quality: int = 92) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError(f"encode failed: {path}")
    encoded.tofile(str(path))


def transform(image: np.ndarray, kind: str) -> np.ndarray:
    h, w = image.shape[:2]

    if kind == "recompress":
        ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 28])
        if not ok:
            raise RuntimeError("recompress encode failed")
        return cv2.imdecode(encoded, cv2.IMREAD_COLOR)

    if kind == "resize":
        small = cv2.resize(image, (w // 2, h // 2), interpolation=cv2.INTER_AREA)
        return cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)

    if kind == "crop30":
        x = int(w * 0.15)
        y = int(h * 0.15)
        crop = image[y:h-y, x:w-x]
        return cv2.resize(crop, (w, h), interpolation=cv2.INTER_CUBIC)

    if kind == "asym_crop50":
        crop = image[int(h * 0.10):int(h * 0.78), int(w * 0.30):int(w * 0.88)]
        return cv2.resize(crop, (w, h), interpolation=cv2.INTER_CUBIC)

    if kind == "watermark":
        out = image.copy()
        overlay = out.copy()
        cv2.rectangle(
            overlay,
            (int(w * 0.55), int(h * 0.72)),
            (int(w * 0.95), int(h * 0.92)),
            (20, 20, 20),
            -1,
        )
        out = cv2.addWeighted(out, 0.72, overlay, 0.28, 0)
        cv2.putText(
            out,
            "TEST WATERMARK",
            (int(w * 0.59), int(h * 0.84)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (245, 245, 245),
            2,
            cv2.LINE_AA,
        )
        return out

    if kind == "rotate5":
        matrix = cv2.getRotationMatrix2D((w / 2, h / 2), 5.0, 1.0)
        return cv2.warpAffine(
            image,
            matrix,
            (w, h),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT,
        )

    raise ValueError(kind)


def make_image_case(root: Path) -> tuple[Path, Path]:
    library = root / "Library" / "Images"
    queries = root / "Query" / "Images"
    library.mkdir(parents=True)
    queries.mkdir(parents=True)

    originals: dict[int, Path] = {}

    for seed in range(12):
        path = library / f"img_{seed:02d}.jpg"
        save_jpeg(path, rich_image(seed))
        originals[seed] = path

    rows = []
    positive_specs = [
        (0, "recompress"),
        (1, "resize"),
        (2, "crop30"),
        (3, "asym_crop50"),
        (4, "watermark"),
        (5, "rotate5"),
    ]

    for index, (seed, kind) in enumerate(positive_specs):
        query = queries / f"positive_{index:02d}_{kind}.jpg"
        save_jpeg(query, transform(rich_image(seed), kind), quality=80)
        rows.append(
            {
                "query": str(query),
                "expected_source": originals[seed].name,
                "relation": kind,
            }
        )

    for negative_seed in range(100, 104):
        query = queries / f"negative_{negative_seed}.jpg"
        save_jpeg(query, rich_image(negative_seed), quality=85)
        rows.append(
            {
                "query": str(query),
                "expected_source": "",
                "relation": "Hard negative",
            }
        )

    manifest = root / "image_manifest.csv"
    with manifest.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["query", "expected_source", "relation"],
        )
        writer.writeheader()
        writer.writerows(rows)

    return library, manifest


def moving_frame(seed: int, t: float, width: int = 640, height: int = 360) -> np.ndarray:
    base = rich_image(seed, width, height)
    frame = base.copy()
    x = int((0.10 + 0.75 * ((t * 0.07 + seed * 0.11) % 1.0)) * width)
    y = int((0.35 + 0.25 * math.sin(t * 0.8 + seed)) * height)
    cv2.circle(frame, (x, y), 16, (250, 250, 250), -1)
    cv2.putText(
        frame,
        f"T={t:04.1f}",
        (20, 40),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        (0, 0, 0),
        3,
        cv2.LINE_AA,
    )
    cv2.putText(
        frame,
        f"T={t:04.1f}",
        (20, 40),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        (255, 255, 255),
        1,
        cv2.LINE_AA,
    )
    return frame


def write_video(path: Path, seed: int, duration: float = 12.0, fps: int = 6) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(
        str(path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (640, 360),
    )
    if not writer.isOpened():
        raise RuntimeError("OpenCV VideoWriter mp4v unavailable")

    for frame_index in range(int(duration * fps)):
        writer.write(moving_frame(seed, frame_index / fps))

    writer.release()


def write_clip(source: Path, output: Path, start: float, duration: float) -> None:
    capture = cv2.VideoCapture(str(source))
    fps = capture.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        raise RuntimeError("Cannot read source fps")

    writer = cv2.VideoWriter(
        str(output),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (640, 360),
    )
    if not writer.isOpened():
        raise RuntimeError("Cannot write clip")

    capture.set(cv2.CAP_PROP_POS_MSEC, start * 1000.0)
    frames = int(duration * fps)
    for _ in range(frames):
        ok, frame = capture.read()
        if not ok:
            break
        writer.write(frame)

    capture.release()
    writer.release()


def make_video_case(root: Path) -> tuple[Path, Path]:
    library = root / "Library" / "Videos"
    queries = root / "Query" / "Videos"
    library.mkdir(parents=True)
    queries.mkdir(parents=True)

    sources = []
    for seed in range(3):
        path = library / f"video_{seed:02d}.mp4"
        write_video(path, seed)
        sources.append(path)

    clip = queries / "clip_video_01.mp4"
    write_clip(sources[1], clip, start=3.0, duration=6.0)

    same = queries / "same_video_00.mp4"
    shutil.copy2(sources[0], same)

    unrelated = queries / "unrelated.mp4"
    write_video(unrelated, 100, duration=8.0)

    manifest = root / "video_manifest.csv"
    with manifest.open("w", encoding="utf-8-sig", newline="") as handle:
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
        writer.writerows(
            [
                {
                    "query": str(same),
                    "expected_source": sources[0].name,
                    "relation": "Same video",
                    "expected_start_sec": "",
                },
                {
                    "query": str(clip),
                    "expected_source": sources[1].name,
                    "relation": "Partial clip",
                    "expected_start_sec": "3.0",
                },
                {
                    "query": str(unrelated),
                    "expected_source": "",
                    "relation": "Unrelated",
                    "expected_start_sec": "",
                },
            ]
        )

    return library, manifest


def run_module(module, argv: list[str]) -> None:
    original = sys.argv[:]
    try:
        sys.argv = [original[0], *argv]
        module.main()
    finally:
        sys.argv = original


def assert_image_results(path: Path) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    summary = data["summary"]

    recall = float(summary["candidate_topk_recall"])
    false_confirmed = int(summary["false_confirmed_count_baseline"])

    if recall < 1.0:
        raise AssertionError(f"image candidate Top-k recall < 100%: {recall}")

    if false_confirmed != 0:
        raise AssertionError(
            f"image hard-negative false confirmed != 0: {false_confirmed}"
        )


def assert_video_results(path: Path) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    summary = data["summary"]

    accuracy = float(summary["top1_accuracy_positive"])
    unexpected = int(summary["unexpected_strong_match_count_baseline"])

    if accuracy < 1.0:
        raise AssertionError(f"video positive Top-1 < 100%: {accuracy}")

    if unexpected != 0:
        raise AssertionError(
            f"video unrelated strong match != 0: {unexpected}"
        )

    start_errors = [
        row.get("start_abs_error_sec")
        for row in data["results"]
        if row.get("start_abs_error_sec") is not None
    ]

    if start_errors and max(start_errors) > 1.25:
        raise AssertionError(f"video clip start error too large: {start_errors}")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="p106-ci-regression-") as temp:
        root = Path(temp)

        image_library, image_manifest = make_image_case(root)
        image_output = root / "a004_results.json"

        run_module(
            image_runner,
            [
                "--library", str(image_library),
                "--manifest", str(image_manifest),
                "--topk", "12",
                "--output", str(image_output),
            ],
        )
        assert_image_results(image_output)

        video_library, video_manifest = make_video_case(root)
        video_output = root / "v011_results.json"

        run_module(
            video_runner,
            [
                "--library", str(video_library),
                "--manifest", str(video_manifest),
                "--interval", "1.0",
                "--output", str(video_output),
            ],
        )
        assert_video_results(video_output)


        auto_root = root / "auto_smoke"
        run_module(
            auto_runner,
            [
                "--image-library", str(image_library),
                "--video-library", str(video_library),
                "--workdir", str(auto_root),
                "--max-images", "4",
                "--max-videos", "2",
            ],
        )
        auto_summary_path = auto_root / "auto_smoke_summary.json"
        if not auto_summary_path.exists():
            raise AssertionError("automatic smoke summary missing")
        auto_summary = json.loads(
            auto_summary_path.read_text(encoding="utf-8")
        )
        if int(auto_summary["generated_image_queries"]) < 4:
            raise AssertionError(
                f"automatic image queries too few: {auto_summary}"
            )
        if int(auto_summary["generated_video_queries"]) < 2:
            raise AssertionError(
                f"automatic video queries too few: {auto_summary}"
            )
        if not auto_summary.get("image"):
            raise AssertionError("automatic image summary missing")
        if not auto_summary.get("video"):
            raise AssertionError("automatic video summary missing")

        image_auto = auto_summary["image"]
        video_auto = auto_summary["video"]

        if float(
            image_auto.get(
                "top1_accuracy_positive",
                0.0,
            )
        ) < 1.0:
            raise AssertionError(
                f"automatic image Top-1 < 100%: {auto_summary}"
            )

        if int(image_auto.get("negative_queries", 0)) < 1:
            raise AssertionError(
                f"automatic image negative sanity missing: {auto_summary}"
            )
        if int(
            image_auto.get(
                "false_confirmed_count_baseline",
                0,
            )
        ) != 0:
            raise AssertionError(
                f"automatic image false confirmed: {auto_summary}"
            )

        if int(video_auto.get("negative_queries", 0)) < 1:
            raise AssertionError(
                f"automatic video negative sanity missing: {auto_summary}"
            )
        if int(
            video_auto.get(
                "unexpected_strong_match_count_baseline",
                0,
            )
        ) != 0:
            raise AssertionError(
                f"automatic video strong false match: {auto_summary}"
            )

        print(
            json.dumps(
                {
                    "ok": True,
                    "image": json.loads(
                        image_output.read_text(encoding="utf-8")
                    )["summary"],
                    "video": json.loads(
                        video_output.read_text(encoding="utf-8")
                    )["summary"],
                },
                ensure_ascii=False,
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
