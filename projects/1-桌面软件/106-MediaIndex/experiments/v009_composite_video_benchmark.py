from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np

from v001_video_sequence_benchmark import (
    generate_library,
    run,
    sample_video,
)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="p106-v009-") as temp:
        root = Path(temp)
        library = generate_library(root)

        composite = root / "composite.mp4"

        run(
            [
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", str(library[1]),
                "-i", str(library[4]),
                "-i", str(library[2]),
                "-filter_complex",
                "[0:v]trim=2:10,setpts=PTS-STARTPTS[a];"
                "[1:v]trim=8:16,setpts=PTS-STARTPTS[b];"
                "[2:v]trim=14:22,setpts=PTS-STARTPTS[c];"
                "[a][b][c]concat=n=3:v=1:a=0[v]",
                "-map", "[v]",
                "-c:v", "libx264",
                "-crf", "31",
                "-preset", "ultrafast",
                "-an",
                str(composite),
            ]
        )

        source_sequences = {
            path.name: sample_video(path)
            for path in library
        }
        query_times, query_hashes = sample_video(composite)

        best_matches = []

        for query_index, query_hash in enumerate(query_hashes):
            best = None

            for source_name, (
                source_times,
                source_hashes,
            ) in source_sequences.items():
                distances = np.bitwise_count(
                    source_hashes ^ query_hash
                )
                source_index = int(distances.argmin())
                distance = int(distances[source_index])

                key = (
                    -distance,
                    source_name,
                    float(source_times[source_index]),
                )

                if best is None or key > best[0]:
                    best = (
                        key,
                        source_name,
                        float(source_times[source_index]),
                        distance,
                    )

            best_matches.append(
                (
                    float(query_times[query_index]),
                    best[1],
                    best[2],
                    best[3],
                )
            )

        runs = []
        current = []

        for match in best_matches:
            if (
                current
                and (
                    match[1] != current[-1][1]
                    or match[0] - current[-1][0] > 1.1
                )
            ):
                runs.append(current)
                current = []

            current.append(match)

        if current:
            runs.append(current)

        print("contiguous source runs")

        for run_items in runs:
            if len(run_items) < 2:
                continue

            print(
                {
                    "query_start": run_items[0][0],
                    "query_end": run_items[-1][0],
                    "source_video": run_items[0][1],
                    "samples": len(run_items),
                    "median_hamming": float(
                        np.median(
                            [item[3] for item in run_items]
                        )
                    ),
                }
            )


if __name__ == "__main__":
    main()
