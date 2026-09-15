from __future__ import annotations

import tempfile
from pathlib import Path

import cv2
import numpy as np

from v001_video_sequence_benchmark import (
    generate_library,
    phash64,
    run,
)


def region_hashes(frame: np.ndarray) -> np.ndarray:
    height, width = frame.shape[:2]
    output = [phash64(frame)]

    for keep in (0.8, 0.6, 0.4):
        crop_h = max(16, int(height * keep))
        crop_w = max(16, int(width * keep))

        for y_fraction in (0.0, 0.5, 1.0):
            for x_fraction in (0.0, 0.5, 1.0):
                y = int((height - crop_h) * y_fraction)
                x = int((width - crop_w) * x_fraction)
                output.append(
                    phash64(
                        frame[
                            y : y + crop_h,
                            x : x + crop_w,
                        ]
                    )
                )
    return np.asarray(output, dtype=np.uint64)


def sample(
    path: Path,
    multi_region: bool,
    interval: float = 1.0,
):
    capture = cv2.VideoCapture(str(path))
    fps = capture.get(cv2.CAP_PROP_FPS)
    step = max(1, int(round(fps * interval)))

    output = []
    frame_index = 0

    while True:
        ok, frame = capture.read()
        if not ok:
            break

        if frame_index % step == 0:
            signature = (
                region_hashes(frame)
                if multi_region
                else phash64(frame)
            )
            output.append(
                (
                    frame_index / fps,
                    signature,
                )
            )
        frame_index += 1

    capture.release()
    return output


def temporal_score(
    query,
    source,
    multi_region: bool,
    threshold: int = 18,
):
    pairs = []

    for query_time, query_hash in query:
        distances = []

        for source_time, source_hash in source:
            if multi_region:
                distance = int(
                    np.bitwise_count(
                        source_hash ^ query_hash
                    ).min()
                )
            else:
                distance = int(
                    np.bitwise_count(
                        source_hash ^ query_hash
                    )
                )
            distances.append(
                (
                    distance,
                    source_time,
                )
            )

        distance, source_time = min(distances)

        if distance <= threshold:
            pairs.append(
                (
                    query_time,
                    source_time,
                    distance,
                )
            )

    if len(pairs) < 2:
        return {
            "score": -1.0,
            "inliers": 0,
        }

    points = np.asarray(pairs, dtype=float)
    best = None

    for first in range(len(points)):
        for second in range(first + 1, len(points)):
            q1, s1 = points[first, :2]
            q2, s2 = points[second, :2]

            if abs(q2 - q1) < 1e-9:
                continue

            slope = (s2 - s1) / (q2 - q1)
            if not 0.7 <= slope <= 1.3:
                continue

            offset = s1 - slope * q1
            residual = np.abs(
                points[:, 1]
                - (slope * points[:, 0] + offset)
            )
            mask = residual <= 1.25
            count = int(mask.sum())

            if count < 2:
                continue

            median_distance = float(
                np.median(points[mask, 2])
            )
            key = (
                count,
                -median_distance,
                -abs(slope - 1.0),
            )

            if best is None or key > best[0]:
                best = (
                    key,
                    count,
                    median_distance,
                )

    if best is None:
        return {
            "score": -1.0,
            "inliers": 0,
        }

    _, count, median_distance = best

    return {
        "score": (
            count / max(1, len(query))
            - median_distance / 128.0
        ),
        "inliers": count,
    }


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="p106-v008-") as temp:
        root = Path(temp)
        library = generate_library(root)
        target = library[2]

        query_dir = root / "queries"
        query_dir.mkdir()

        commands = {
            "subtitles.mp4": [
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", str(target),
                "-vf",
                "drawbox=x=0:y=ih*0.80:w=iw:h=ih*0.20:"
                "color=black@0.55:t=fill,"
                "drawbox=x=iw*0.12:y=ih*0.84:"
                "w=iw*0.55:h=5:color=white@0.9:t=fill",
                "-c:v", "libx264", "-crf", "30",
                "-preset", "ultrafast", "-an",
            ],
            "letterbox.mp4": [
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", str(target),
                "-vf", "scale=640:270,pad=640:360:0:45:black",
                "-c:v", "libx264", "-crf", "30",
                "-preset", "ultrafast", "-an",
            ],
            "vertical_crop.mp4": [
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", str(target),
                "-vf",
                "crop=202:360:(iw-202)/2:0,scale=360:640",
                "-c:v", "libx264", "-crf", "30",
                "-preset", "ultrafast", "-an",
            ],
        }

        for name, command in commands.items():
            output = query_dir / name
            run(command + [str(output)])

        for multi_region in (False, True):
            library_signatures = {
                path.name: sample(
                    path,
                    multi_region=multi_region,
                )
                for path in library
            }

            print()
            print(
                "mode=",
                "multi-region"
                if multi_region
                else "global",
            )

            for query_path in sorted(query_dir.glob("*.mp4")):
                query = sample(
                    query_path,
                    multi_region=False,
                )

                candidates = []
                for source_name, source in library_signatures.items():
                    result = temporal_score(
                        query,
                        source,
                        multi_region=multi_region,
                    )
                    candidates.append(
                        (
                            result["score"],
                            source_name,
                            result,
                        )
                    )

                candidates.sort(
                    reverse=True,
                    key=lambda item: item[0],
                )
                print(
                    query_path.name,
                    candidates[:3],
                )


if __name__ == "__main__":
    main()
