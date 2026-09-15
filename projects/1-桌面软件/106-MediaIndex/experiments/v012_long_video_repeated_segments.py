from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np
from skimage import data


WIDTH = 640
HEIGHT = 360
FPS = 4
DURATION = 60
INTRO = 6
OUTRO = 6


def run(command):
    subprocess.run(command, check=True)


def to_bgr(image):
    image = np.asarray(image)
    if image.ndim == 2:
        return cv2.cvtColor(
            image.astype(np.uint8),
            cv2.COLOR_GRAY2BGR,
        )
    if image.shape[2] > 3:
        image = image[:, :, :3]
    return cv2.cvtColor(
        image.astype(np.uint8),
        cv2.COLOR_RGB2BGR,
    )


def fit_crop(image, timestamp, seed=0):
    height, width = image.shape[:2]
    aspect = WIDTH / HEIGHT

    if width / height > aspect:
        crop_height = height * 0.9
        crop_width = crop_height * aspect
    else:
        crop_width = width * 0.9
        crop_height = crop_width / aspect

    max_x = max(0, width - crop_width)
    max_y = max(0, height - crop_height)

    x = int(
        (
            0.5
            + 0.4
            * np.sin(
                0.25 * timestamp + seed
            )
        )
        * max_x
    )
    y = int(
        (
            0.5
            + 0.4
            * np.cos(
                0.21 * timestamp
                + seed * 0.3
            )
        )
        * max_y
    )

    crop = image[
        y:y + int(crop_height),
        x:x + int(crop_width),
    ]

    return cv2.resize(
        crop,
        (WIDTH, HEIGHT),
        interpolation=cv2.INTER_AREA,
    )


def phash64(frame):
    gray = cv2.cvtColor(
        frame,
        cv2.COLOR_BGR2GRAY,
    )
    small = cv2.resize(
        gray,
        (32, 32),
        interpolation=cv2.INTER_AREA,
    ).astype(np.float32)

    values = cv2.dct(small)[:8, :8].ravel()
    median = np.median(values[1:])

    output = np.uint64(0)
    for index, value in enumerate(values > median):
        if value:
            output |= (
                np.uint64(1)
                << np.uint64(index)
            )
    return output


def sample_video(path, interval=1.0):
    capture = cv2.VideoCapture(str(path))
    fps = capture.get(cv2.CAP_PROP_FPS)
    count = capture.get(
        cv2.CAP_PROP_FRAME_COUNT
    )
    duration = count / fps

    times = []
    hashes = []

    for timestamp in np.arange(
        0,
        duration - 1e-6,
        interval,
    ):
        capture.set(
            cv2.CAP_PROP_POS_MSEC,
            float(timestamp * 1000),
        )
        ok, frame = capture.read()
        if not ok:
            break

        times.append(float(timestamp))
        hashes.append(phash64(frame))

    capture.release()

    return (
        np.asarray(times),
        np.asarray(hashes, dtype=np.uint64),
    )


def make_library(root):
    images = [
        to_bgr(getattr(data, name)())
        for name in [
            "astronaut",
            "camera",
            "coffee",
            "rocket",
            "chelsea",
            "moon",
            "retina",
            "coins",
            "brick",
            "grass",
            "page",
            "horse",
        ]
    ]

    intro_image = images[0]
    outro_image = images[1]

    videos = []

    for video_id in range(4):
        path = root / f"long_{video_id}.mp4"

        writer = cv2.VideoWriter(
            str(path),
            cv2.VideoWriter_fourcc(*"mp4v"),
            FPS,
            (WIDTH, HEIGHT),
        )

        unique = [
            images[2 + video_id * 2],
            images[3 + video_id * 2],
        ]

        repeated_image = (
            images[10]
            if video_id == 2
            else None
        )

        for frame_index in range(
            DURATION * FPS
        ):
            timestamp = frame_index / FPS

            if timestamp < INTRO:
                frame = fit_crop(
                    intro_image,
                    timestamp,
                    0,
                )
            elif timestamp >= DURATION - OUTRO:
                frame = fit_crop(
                    outro_image,
                    timestamp,
                    1,
                )
            else:
                local = timestamp - INTRO

                repeated = (
                    video_id == 2
                    and (
                        18 <= timestamp < 23
                        or 36 <= timestamp < 41
                    )
                )

                if repeated:
                    frame = fit_crop(
                        repeated_image,
                        timestamp % 18,
                        7,
                    )
                else:
                    frame = fit_crop(
                        unique[
                            int(local // 12) % 2
                        ],
                        local,
                        video_id + 2,
                    )

            if (
                INTRO <= timestamp
                < DURATION - OUTRO
                and not (
                    video_id == 2
                    and (
                        18 <= timestamp < 23
                        or 36 <= timestamp < 41
                    )
                )
            ):
                x = int(
                    (
                        0.1
                        + 0.75
                        * (
                            (
                                timestamp * 0.03
                                + video_id * 0.17
                            )
                            % 1
                        )
                    )
                    * WIDTH
                )
                y = 40 + video_id * 35

                cv2.circle(
                    frame,
                    (x, y),
                    8,
                    (
                        20 + video_id * 30,
                        170,
                        80 + video_id * 20,
                    ),
                    -1,
                )

            writer.write(frame)

        writer.release()
        videos.append(path)

    return videos


def make_clip(source, output, start, duration):
    run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-ss",
            str(start),
            "-i",
            str(source),
            "-t",
            str(duration),
            "-c:v",
            "libx264",
            "-crf",
            "32",
            "-preset",
            "ultrafast",
            "-an",
            str(output),
        ]
    )


def offset_votes(
    query_times,
    query_hashes,
    source_times,
    source_hashes,
    threshold=16,
):
    distance = np.bitwise_count(
        query_hashes[:, None]
        ^ source_hashes[None, :]
    )

    rows = []

    for index in range(len(query_hashes)):
        order = np.argsort(
            distance[index]
        )[:3]

        for source_index in order:
            current = int(
                distance[
                    index,
                    source_index,
                ]
            )
            if current <= threshold:
                rows.append(
                    (
                        query_times[index],
                        source_times[
                            source_index
                        ],
                        current,
                    )
                )

    votes = {}

    for query_time, source_time, current in rows:
        offset = round(
            source_time - query_time,
            1,
        )
        votes.setdefault(
            offset,
            [],
        ).append(current)

    ranked = sorted(
        (
            (
                len(values),
                -float(np.median(values)),
                offset,
            )
            for offset, values
            in votes.items()
        ),
        reverse=True,
    )

    return ranked


def rank_query(query_path, sequences):
    query_times, query_hashes = (
        sample_video(query_path)
    )

    result = []

    for name, (
        source_times,
        source_hashes,
    ) in sequences.items():
        offsets = offset_votes(
            query_times,
            query_hashes,
            source_times,
            source_hashes,
        )

        best = (
            offsets[0]
            if offsets
            else (0, -99.0, 0.0)
        )

        score = (
            best[0]
            + best[1] / 64.0
        )

        result.append(
            (
                score,
                name,
                best,
                offsets[:4],
            )
        )

    return sorted(
        result,
        reverse=True,
    )


def main():
    with tempfile.TemporaryDirectory(
        prefix="p106-v012-"
    ) as temp:
        root = Path(temp)
        videos = make_library(root)

        sequences = {
            path.name: sample_video(path)
            for path in videos
        }

        cases = {
            "intro_only": (
                videos[2], 1, 4
            ),
            "unique_mid": (
                videos[2], 25, 8
            ),
            "cross_intro_unique": (
                videos[2], 4, 8
            ),
            "shared_outro": (
                videos[2], 55, 4
            ),
            "repeated_motif_first": (
                videos[2], 18, 5
            ),
        }

        for name, (
            source,
            start,
            duration,
        ) in cases.items():
            query = root / f"{name}.mp4"
            make_clip(
                source,
                query,
                start,
                duration,
            )

            print()
            print("CASE", name)

            for row in rank_query(
                query,
                sequences,
            )[:4]:
                print(row)


if __name__ == "__main__":
    main()
