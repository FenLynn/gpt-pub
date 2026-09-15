from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np
from skimage import data


WIDTH = 640
HEIGHT = 360
FPS = 8
DURATION = 24


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def to_bgr(image: np.ndarray) -> np.ndarray:
    image = np.asarray(image)
    if image.ndim == 2:
        return cv2.cvtColor(image.astype(np.uint8), cv2.COLOR_GRAY2BGR)
    if image.shape[2] > 3:
        image = image[:, :, :3]
    return cv2.cvtColor(image.astype(np.uint8), cv2.COLOR_RGB2BGR)


def make_frame(
    image: np.ndarray,
    local_time: float,
    video_id: int,
    segment: int,
) -> np.ndarray:
    height, width = image.shape[:2]
    zoom = 1.0 + 0.08 * np.sin(
        2 * np.pi * (local_time / 6.0 + 0.13 * video_id)
    )
    target_aspect = WIDTH / HEIGHT

    if width / height > target_aspect:
        crop_height = height / zoom
        crop_width = crop_height * target_aspect
    else:
        crop_width = width / zoom
        crop_height = crop_width / target_aspect

    max_x = max(0.0, width - crop_width)
    max_y = max(0.0, height - crop_height)

    x = int(
        np.clip(
            (0.5 + 0.35 * np.sin(0.7 * local_time + video_id * 0.8 + segment))
            * max_x,
            0,
            max_x,
        )
    )
    y = int(
        np.clip(
            (0.5 + 0.35 * np.cos(0.5 * local_time + video_id * 0.6 - segment))
            * max_y,
            0,
            max_y,
        )
    )

    crop_width_i = max(2, int(crop_width))
    crop_height_i = max(2, int(crop_height))
    crop = image[
        y : min(height, y + crop_height_i),
        x : min(width, x + crop_width_i),
    ]
    frame = cv2.resize(
        crop,
        (WIDTH, HEIGHT),
        interpolation=cv2.INTER_AREA,
    )

    overlay = frame.copy()
    center_x = int(
        (0.1 + 0.8 * ((local_time * 0.07 + video_id * 0.11) % 1.0))
        * WIDTH
    )
    center_y = int(
        (0.2 + 0.6 * (0.5 + 0.5 * np.sin(local_time * 0.9 + video_id)))
        * HEIGHT
    )
    cv2.circle(
        overlay,
        (center_x, center_y),
        10 + 3 * (video_id % 3),
        (40 + 20 * video_id, 180 - 10 * video_id, 80 + 15 * segment),
        -1,
    )
    return cv2.addWeighted(frame, 0.94, overlay, 0.06, 0)


def generate_library(root: Path) -> list[Path]:
    names = [
        "astronaut",
        "camera",
        "brick",
        "cell",
        "chelsea",
        "clock",
        "coffee",
        "coins",
        "grass",
        "gravel",
        "horse",
        "hubble_deep_field",
        "immunohistochemistry",
        "moon",
        "page",
        "retina",
        "rocket",
        "text",
        "colorwheel",
        "logo",
    ]
    images = [to_bgr(getattr(data, name)()) for name in names]

    library = []
    for video_id in range(6):
        path = root / f"lib_{video_id:02d}.mp4"
        writer = cv2.VideoWriter(
            str(path),
            cv2.VideoWriter_fourcc(*"mp4v"),
            FPS,
            (WIDTH, HEIGHT),
        )
        indices = [
            (video_id * 3 + segment * 4) % len(images)
            for segment in range(4)
        ]
        for frame_index in range(FPS * DURATION):
            time_s = frame_index / FPS
            segment = min(3, int(time_s // 6))
            writer.write(
                make_frame(
                    images[indices[segment]],
                    time_s - segment * 6,
                    video_id,
                    segment,
                )
            )
        writer.release()
        library.append(path)
    return library


def phash64(frame: np.ndarray) -> np.uint64:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(
        gray,
        (32, 32),
        interpolation=cv2.INTER_AREA,
    ).astype(np.float32)
    values = cv2.dct(small)[:8, :8].ravel()
    median = np.median(values[1:])

    result = np.uint64(0)
    for index, value in enumerate(values > median):
        if value:
            result |= np.uint64(1) << np.uint64(index)
    return result


def sample_video(
    path: Path,
    interval: float = 1.0,
) -> tuple[np.ndarray, np.ndarray]:
    capture = cv2.VideoCapture(str(path))
    fps = capture.get(cv2.CAP_PROP_FPS)
    frame_count = capture.get(cv2.CAP_PROP_FRAME_COUNT)
    duration = frame_count / fps if fps else 0.0

    times = []
    hashes = []
    for timestamp in np.arange(0, duration - 1e-6, interval):
        capture.set(cv2.CAP_PROP_POS_MSEC, float(timestamp * 1000))
        ok, frame = capture.read()
        if not ok:
            break
        times.append(float(timestamp))
        hashes.append(phash64(frame))

    capture.release()
    return np.asarray(times), np.asarray(hashes, dtype=np.uint64)


def fit_time_model(
    query_times: np.ndarray,
    query_hashes: np.ndarray,
    source_times: np.ndarray,
    source_hashes: np.ndarray,
    distance_threshold: int = 18,
    residual_threshold: float = 1.25,
) -> dict:
    distances = np.bitwise_count(
        query_hashes[:, None] ^ source_hashes[None, :]
    ).astype(np.int16)

    best_source_index = distances.argmin(axis=1)
    best_distance = distances[
        np.arange(len(query_hashes)),
        best_source_index,
    ]

    pairs = np.asarray(
        [
            (
                query_times[index],
                source_times[best_source_index[index]],
                best_distance[index],
            )
            for index in range(len(query_hashes))
            if best_distance[index] <= distance_threshold
        ],
        dtype=float,
    )

    if len(pairs) < 2:
        return {
            "score": -1.0,
            "inliers": 0,
            "fraction": 0.0,
            "median_distance": 99.0,
            "slope": 0.0,
            "offset": 0.0,
        }

    best = None
    for first in range(len(pairs)):
        for second in range(first + 1, len(pairs)):
            q1, s1 = pairs[first, :2]
            q2, s2 = pairs[second, :2]
            if abs(q2 - q1) < 1e-9:
                continue

            slope = (s2 - s1) / (q2 - q1)
            if not 0.7 <= slope <= 1.3:
                continue

            offset = s1 - slope * q1
            residual = np.abs(
                pairs[:, 1] - (slope * pairs[:, 0] + offset)
            )
            inlier_mask = residual <= residual_threshold
            inlier_count = int(inlier_mask.sum())
            if inlier_count < 2:
                continue

            median_distance = float(
                np.median(pairs[inlier_mask, 2])
            )
            key = (
                inlier_count,
                -median_distance,
                -abs(slope - 1.0),
            )
            if best is None or key > best[0]:
                best = (
                    key,
                    slope,
                    offset,
                    inlier_count,
                    median_distance,
                )

    if best is None:
        return {
            "score": -1.0,
            "inliers": 0,
            "fraction": 0.0,
            "median_distance": 99.0,
            "slope": 0.0,
            "offset": 0.0,
        }

    _, slope, offset, inliers, median_distance = best
    fraction = inliers / max(1, len(query_hashes))
    return {
        "score": fraction - median_distance / 128.0,
        "inliers": inliers,
        "fraction": fraction,
        "median_distance": median_distance,
        "slope": float(slope),
        "offset": float(offset),
    }


def main() -> None:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg is required")

    with tempfile.TemporaryDirectory(prefix="p106-video-") as temp:
        root = Path(temp)
        library = generate_library(root)
        query_dir = root / "queries"
        query_dir.mkdir()

        target = library[2]

        variants = {
            "h264_crf32_480p.mp4": [
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", str(target),
                "-vf", "scale=854:480",
                "-c:v", "libx264", "-crf", "32",
                "-preset", "ultrafast", "-an",
            ],
            "hevc_crf35_360p.mp4": [
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", str(target),
                "-vf", "scale=640:360",
                "-c:v", "libx265", "-crf", "35",
                "-preset", "ultrafast", "-an",
            ],
            "fps4.mp4": [
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", str(target),
                "-vf", "fps=4",
                "-c:v", "libx264", "-crf", "28",
                "-preset", "ultrafast", "-an",
            ],
            "clip8_mid.mp4": [
                "ffmpeg", "-y", "-loglevel", "error",
                "-ss", "7", "-i", str(target), "-t", "8",
                "-c:v", "libx264", "-crf", "30",
                "-preset", "ultrafast", "-an",
            ],
            "speed105.mp4": [
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", str(target),
                "-vf", "setpts=PTS/1.05,fps=8",
                "-c:v", "libx264", "-crf", "29",
                "-preset", "ultrafast", "-an",
            ],
        }

        for filename, command in variants.items():
            output = query_dir / filename
            run(command + [str(output)])

        source_sequences = {
            path.name: sample_video(path)
            for path in library
        }

        for query_path in sorted(query_dir.glob("*.mp4")):
            interval = 0.5 if query_path.name == "speed105.mp4" else 1.0
            query_times, query_hashes = sample_video(
                query_path,
                interval=interval,
            )

            candidates = []
            for source_name, (source_times, source_hashes) in source_sequences.items():
                if interval != 1.0:
                    source_times, source_hashes = sample_video(
                        root / source_name,
                        interval=interval,
                    )
                result = fit_time_model(
                    query_times,
                    query_hashes,
                    source_times,
                    source_hashes,
                    residual_threshold=0.55 if interval < 1.0 else 1.25,
                )
                candidates.append((result["score"], source_name, result))

            candidates.sort(reverse=True, key=lambda row: row[0])
            score, source_name, result = candidates[0]
            print(
                query_path.name,
                "->",
                source_name,
                result,
            )


if __name__ == "__main__":
    main()
