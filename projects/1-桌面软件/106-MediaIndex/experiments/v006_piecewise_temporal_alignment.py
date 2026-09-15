from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np

from v001_video_sequence_benchmark import (
    generate_library,
    run,
    sample_video,
)


def correspondences(
    query_path: Path,
    source_path: Path,
    interval: float = 1.0,
    distance_threshold: int = 14,
) -> tuple[list[tuple[float, float, int]], int]:
    query_times, query_hashes = sample_video(
        query_path,
        interval=interval,
    )
    source_times, source_hashes = sample_video(
        source_path,
        interval=interval,
    )

    distances = np.bitwise_count(
        query_hashes[:, None] ^ source_hashes[None, :]
    )
    best = distances.argmin(axis=1)

    pairs = []
    for index in range(len(query_hashes)):
        distance = int(distances[index, best[index]])
        if distance <= distance_threshold:
            pairs.append(
                (
                    float(query_times[index]),
                    float(source_times[best[index]]),
                    distance,
                )
            )
    return pairs, len(query_hashes)


def fit_affine(
    pairs: list[tuple[float, float, int]],
    scale_low: float = 0.9,
    scale_high: float = 1.1,
    residual_threshold: float = 0.75,
):
    if len(pairs) < 2:
        return None

    points = np.asarray(pairs, dtype=float)
    best = None

    for first in range(len(points)):
        for second in range(first + 1, len(points)):
            q1, s1 = points[first, :2]
            q2, s2 = points[second, :2]
            if abs(q2 - q1) < 1e-9:
                continue

            scale = (s2 - s1) / (q2 - q1)
            if not scale_low <= scale <= scale_high:
                continue

            offset = s1 - scale * q1
            residual = np.abs(
                points[:, 1] - (scale * points[:, 0] + offset)
            )
            mask = residual <= residual_threshold
            count = int(mask.sum())
            if count < 2:
                continue

            median_distance = float(
                np.median(points[mask, 2])
            )
            key = (
                count,
                -median_distance,
                -abs(scale - 1.0),
            )
            if best is None or key > best[0]:
                best = (
                    key,
                    scale,
                    offset,
                    count,
                    median_distance,
                )
    return best


def segment_offsets(
    pairs: list[tuple[float, float, int]],
    tolerance: float = 1.1,
    max_query_gap: float = 2.1,
    minimum_length: int = 2,
):
    raw_segments = []
    current = []

    for pair in pairs:
        offset = pair[1] - pair[0]

        if not current:
            current = [pair]
            continue

        current_offset = float(
            np.median(
                [item[1] - item[0] for item in current]
            )
        )

        if (
            abs(offset - current_offset) <= tolerance
            and pair[0] - current[-1][0] <= max_query_gap
        ):
            current.append(pair)
        else:
            if len(current) >= minimum_length:
                raw_segments.append(current)
            current = [pair]

    if len(current) >= minimum_length:
        raw_segments.append(current)

    result = []
    for segment in raw_segments:
        result.append(
            {
                "query_start": segment[0][0],
                "query_end": segment[-1][0],
                "offset": float(
                    np.median(
                        [item[1] - item[0] for item in segment]
                    )
                ),
                "samples": len(segment),
            }
        )
    return result


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="p106-v006-") as temp:
        root = Path(temp)
        library = generate_library(root)
        source = library[2]

        query_dir = root / "queries"
        query_dir.mkdir()

        commands = {
            "clip8.mp4": [
                "ffmpeg", "-y", "-loglevel", "error",
                "-ss", "7", "-i", str(source), "-t", "8",
                "-c:v", "libx264", "-crf", "30",
                "-preset", "ultrafast", "-an",
            ],
            "remove_mid4.mp4": [
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", str(source),
                "-filter_complex",
                "[0:v]trim=0:8,setpts=PTS-STARTPTS[a];"
                "[0:v]trim=12:24,setpts=PTS-STARTPTS[b];"
                "[a][b]concat=n=2:v=1:a=0[v]",
                "-map", "[v]",
                "-c:v", "libx264", "-crf", "30",
                "-preset", "ultrafast", "-an",
            ],
        }

        for name, command in commands.items():
            output = query_dir / name
            run(command + [str(output)])

            pairs, total = correspondences(
                output,
                source,
                interval=1.0,
            )
            affine = fit_affine(pairs)
            segments = segment_offsets(pairs)

            print()
            print(name)
            print(f"matched_pairs={len(pairs)}/{total}")
            print("affine=", affine)
            print("segments=", segments)


if __name__ == "__main__":
    main()
