from __future__ import annotations

import re
import tempfile
from pathlib import Path

import numpy as np

from v001_video_sequence_benchmark import (
    fit_time_model,
    generate_library,
    run,
    sample_video,
)


def build_queries(root: Path, target: Path) -> list[tuple[Path, str | None]]:
    query_dir = root / "queries-v005"
    query_dir.mkdir()

    commands = {
        "full.mp4": [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(target),
            "-c:v", "libx264", "-crf", "34",
            "-preset", "ultrafast", "-an",
        ],
        "clip8.mp4": [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", "7", "-i", str(target), "-t", "8",
            "-c:v", "libx264", "-crf", "34",
            "-preset", "ultrafast", "-an",
        ],
        "clip5.mp4": [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", "7", "-i", str(target), "-t", "5",
            "-c:v", "libx264", "-crf", "34",
            "-preset", "ultrafast", "-an",
        ],
        "clip3.mp4": [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", "7", "-i", str(target), "-t", "3",
            "-c:v", "libx264", "-crf", "34",
            "-preset", "ultrafast", "-an",
        ],
        "crop10.mp4": [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(target),
            "-vf",
            "crop=iw*0.9:ih*0.9:(iw-iw*0.9)/2:(ih-ih*0.9)/2,"
            "scale=640:360",
            "-c:v", "libx264", "-crf", "28",
            "-preset", "ultrafast", "-an",
        ],
        "watermark.mp4": [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(target),
            "-vf",
            "drawbox=x=iw*0.58:y=ih*0.72:w=iw*0.38:h=ih*0.18:"
            "color=black@0.45:t=fill",
            "-c:v", "libx264", "-crf", "28",
            "-preset", "ultrafast", "-an",
        ],
        "clip8_crop_wm.mp4": [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", "7", "-i", str(target), "-t", "8",
            "-vf",
            "crop=iw*0.8:ih*0.8:(iw-iw*0.8)*0.7:(ih-ih*0.8)*0.2,"
            "scale=640:360,"
            "drawbox=x=iw*0.55:y=ih*0.78:w=iw*0.4:h=ih*0.15:"
            "color=black@0.45:t=fill",
            "-c:v", "libx264", "-crf", "32",
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

    result = []
    for name, command in commands.items():
        output = query_dir / name
        run(command + [str(output)])
        result.append((output, "lib_02.mp4"))
    return result


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="p106-v005-") as temp:
        root = Path(temp)
        library = generate_library(root)
        queries = build_queries(root, library[2])

        for interval in (0.5, 1.0, 2.0, 4.0):
            library_sequences = {
                path.name: sample_video(path, interval=interval)
                for path in library
            }

            correct = 0
            weak = 0

            print()
            print(f"sampling_interval={interval}s")

            for query_path, expected in queries:
                query_times, query_hashes = sample_video(
                    query_path,
                    interval=interval,
                )
                candidates = []

                for source_name, (source_times, source_hashes) in library_sequences.items():
                    result = fit_time_model(
                        query_times,
                        query_hashes,
                        source_times,
                        source_hashes,
                        residual_threshold=max(0.55, interval * 0.65),
                    )
                    candidates.append(
                        (result["score"], source_name, result)
                    )

                candidates.sort(
                    reverse=True,
                    key=lambda item: item[0],
                )
                _, source_name, result = candidates[0]

                is_correct = source_name == expected
                correct += int(is_correct)
                weak += int(result["inliers"] < 3)

                print(
                    query_path.name,
                    "samples=",
                    len(query_hashes),
                    "top=",
                    source_name,
                    "correct=",
                    is_correct,
                    "inliers=",
                    result["inliers"],
                )

            print(
                "summary",
                f"correct={correct}/{len(queries)}",
                f"weak_lt3={weak}",
            )


if __name__ == "__main__":
    main()
