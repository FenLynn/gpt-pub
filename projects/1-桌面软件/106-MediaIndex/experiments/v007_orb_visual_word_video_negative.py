from __future__ import annotations

import tempfile
from pathlib import Path

import cv2
import numpy as np
from sklearn.cluster import MiniBatchKMeans

from v001_video_sequence_benchmark import (
    generate_library,
    run,
)


def sample_orb(
    path: Path,
    interval: float = 1.0,
):
    orb = cv2.ORB_create(
        nfeatures=500,
        fastThreshold=10,
    )

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
            gray = cv2.cvtColor(
                frame,
                cv2.COLOR_BGR2GRAY,
            )
            _, descriptors = orb.detectAndCompute(
                gray,
                None,
            )
            output.append(
                (
                    frame_index / fps,
                    descriptors,
                )
            )
        frame_index += 1

    capture.release()
    return output


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="p106-v007-") as temp:
        root = Path(temp)
        library = generate_library(root)

        source_frames = []
        frames_by_video = {}

        for video_id, path in enumerate(library):
            frames_by_video[video_id] = []
            for timestamp, descriptors in sample_orb(path):
                frame_id = len(source_frames)
                source_frames.append(
                    (
                        video_id,
                        timestamp,
                        descriptors,
                    )
                )
                frames_by_video[video_id].append(frame_id)

        training = np.vstack(
            [
                descriptors
                for _, _, descriptors in source_frames
                if descriptors is not None
            ]
        ).astype(np.float32)

        rng = np.random.default_rng(106)
        if len(training) > 18_000:
            training = training[
                rng.choice(
                    len(training),
                    18_000,
                    replace=False,
                )
            ]

        codebook = MiniBatchKMeans(
            n_clusters=256,
            batch_size=2048,
            n_init=1,
            random_state=106,
            max_iter=80,
        ).fit(training)

        def words(descriptors):
            if descriptors is None or len(descriptors) == 0:
                return np.empty(0, dtype=np.int32)
            return np.unique(
                codebook.predict(
                    descriptors.astype(np.float32)
                )
            ).astype(np.int32)

        source_words = [
            words(descriptors)
            for _, _, descriptors in source_frames
        ]

        document_frequency = np.zeros(
            256,
            dtype=np.int32,
        )
        for frame_word_set in source_words:
            document_frequency[frame_word_set] += 1

        idf = np.log(
            (len(source_frames) + 1)
            / (document_frequency + 1)
        ).astype(np.float32)

        def similarity(left, right) -> float:
            if len(left) == 0 or len(right) == 0:
                return 0.0
            common = np.intersect1d(
                left,
                right,
                assume_unique=True,
            )
            return float(idf[common].sum())

        query_dir = root / "queries"
        query_dir.mkdir()

        target = library[2]
        query_commands = {
            "clip8.mp4": [
                "ffmpeg", "-y", "-loglevel", "error",
                "-ss", "7", "-i", str(target), "-t", "8",
                "-c:v", "libx264", "-crf", "30",
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
        }

        for name, command in query_commands.items():
            output = query_dir / name
            run(command + [str(output)])

            video_votes = np.zeros(
                len(library),
                dtype=np.float32,
            )

            for _, descriptors in sample_orb(output):
                query_words = words(descriptors)
                frame_scores = []

                for frame_id, source_word_set in enumerate(source_words):
                    frame_scores.append(
                        (
                            similarity(
                                query_words,
                                source_word_set,
                            ),
                            frame_id,
                        )
                    )

                frame_scores.sort(reverse=True)

                for score, frame_id in frame_scores[:5]:
                    video_id = source_frames[frame_id][0]
                    video_votes[video_id] += score

            order = np.argsort(video_votes)[::-1]
            print(
                name,
                [
                    (
                        int(video_id),
                        float(video_votes[video_id]),
                    )
                    for video_id in order[:3]
                ],
            )

        print()
        print(
            "This benchmark intentionally demonstrates that "
            "unordered small-vocabulary ORB BoVW voting can confuse "
            "related videos. Temporal consistency must be part of "
            "candidate scoring."
        )


if __name__ == "__main__":
    main()
