from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np
from skimage import data


WIDTH = 640
HEIGHT = 360
FPS = 6
DURATION = 24


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


def make_frame(
    image,
    timestamp,
    video_id,
    segment,
):
    height, width = image.shape[:2]
    aspect = WIDTH / HEIGHT

    if width / height > aspect:
        crop_height = height * 0.88
        crop_width = crop_height * aspect
    else:
        crop_width = width * 0.88
        crop_height = crop_width / aspect

    max_x = max(0, width - crop_width)
    max_y = max(0, height - crop_height)

    x = int(
        (
            0.5
            + 0.36
            * np.sin(
                0.55 * timestamp
                + video_id * 0.7
                + segment
            )
        )
        * max_x
    )
    y = int(
        (
            0.5
            + 0.36
            * np.cos(
                0.47 * timestamp
                + video_id * 0.5
                - segment
            )
        )
        * max_y
    )

    frame = cv2.resize(
        image[
            y:y + int(crop_height),
            x:x + int(crop_width),
        ],
        (WIDTH, HEIGHT),
        interpolation=cv2.INTER_AREA,
    )

    center_x = int(
        (
            0.1
            + 0.78
            * (
                (
                    timestamp * 0.09
                    + video_id * 0.13
                )
                % 1
            )
        )
        * WIDTH
    )
    center_y = int(
        (
            0.25
            + 0.3
            * np.sin(
                timestamp * 0.8
                + video_id
            )
        )
        * HEIGHT
    )

    cv2.circle(
        frame,
        (center_x, center_y),
        10,
        (
            40 + video_id * 20,
            170 - segment * 15,
            90 + segment * 20,
        ),
        -1,
    )

    return frame


def make_library(root):
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

    images = [
        to_bgr(getattr(data, name)())
        for name in names
    ]

    videos = []

    for video_id in range(6):
        path = root / f"lib_{video_id:02d}.mp4"

        writer = cv2.VideoWriter(
            str(path),
            cv2.VideoWriter_fourcc(*"mp4v"),
            FPS,
            (WIDTH, HEIGHT),
        )

        image_ids = [
            (
                video_id * 3
                + segment * 4
            )
            % len(images)
            for segment in range(4)
        ]

        for frame_index in range(
            FPS * DURATION
        ):
            timestamp = frame_index / FPS
            segment = min(
                3,
                int(timestamp // 6),
            )

            writer.write(
                make_frame(
                    images[
                        image_ids[segment]
                    ],
                    timestamp
                    - segment * 6,
                    video_id,
                    segment,
                )
            )

        writer.release()
        videos.append(path)

    return videos


def resize_max(frame, max_dimension=480):
    height, width = frame.shape[:2]
    scale = min(
        1.0,
        max_dimension
        / max(height, width),
    )

    if scale >= 1.0:
        return frame

    return cv2.resize(
        frame,
        (
            int(width * scale),
            int(height * scale),
        ),
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


def sample_video(path):
    capture = cv2.VideoCapture(str(path))
    fps = capture.get(cv2.CAP_PROP_FPS)
    count = capture.get(
        cv2.CAP_PROP_FRAME_COUNT
    )
    duration = count / fps

    output = []

    for timestamp in np.arange(
        0,
        duration - 1e-6,
        1.0,
    ):
        capture.set(
            cv2.CAP_PROP_POS_MSEC,
            float(timestamp * 1000),
        )
        ok, frame = capture.read()
        if not ok:
            break

        output.append(
            (
                float(timestamp),
                frame,
                phash64(frame),
            )
        )

    capture.release()
    return output


def phash_candidate(
    query_frames,
    source_frames,
):
    offsets = []
    distances = []

    for query_time, _, query_hash in query_frames:
        row = [
            int(
                np.bitwise_count(
                    query_hash ^ source_hash
                )
            )
            for _, _, source_hash
            in source_frames
        ]

        index = int(np.argmin(row))
        offsets.append(
            round(
                source_frames[index][0]
                - query_time
            )
        )
        distances.append(row[index])

    values, counts = np.unique(
        offsets,
        return_counts=True,
    )

    offset = int(
        values[
            np.argmax(counts)
        ]
    )

    coherent = [
        distance
        for current_offset, distance
        in zip(offsets, distances)
        if current_offset == offset
    ]

    return (
        int(max(counts)),
        -float(np.median(coherent)),
        offset,
        float(np.median(distances)),
    )


def extract(frame, sift):
    frame = resize_max(frame)
    gray = cv2.cvtColor(
        frame,
        cv2.COLOR_BGR2GRAY,
    )
    keypoints, descriptors = (
        sift.detectAndCompute(
            gray,
            None,
        )
    )
    return gray, keypoints, descriptors


def pair_score(
    query_feature,
    source_feature,
    matcher,
):
    _, query_keypoints, query_descriptors = (
        query_feature
    )
    _, source_keypoints, source_descriptors = (
        source_feature
    )

    if (
        query_descriptors is None
        or source_descriptors is None
    ):
        return 0, 0.0, 0

    pairs = matcher.knnMatch(
        query_descriptors,
        source_descriptors,
        k=2,
    )

    good = [
        pair[0]
        for pair in pairs
        if len(pair) >= 2
        and pair[0].distance
        < 0.75 * pair[1].distance
    ]

    if len(good) < 4:
        return 0, 0.0, len(good)

    source = np.float32(
        [
            query_keypoints[
                match.queryIdx
            ].pt
            for match in good
        ]
    ).reshape(-1, 1, 2)

    target = np.float32(
        [
            source_keypoints[
                match.trainIdx
            ].pt
            for match in good
        ]
    ).reshape(-1, 1, 2)

    homography, mask = cv2.findHomography(
        source,
        target,
        cv2.RANSAC,
        4.0,
    )

    if homography is None or mask is None:
        return 0, 0.0, len(good)

    inliers = int(mask.sum())
    ratio = inliers / max(1, len(good))

    return inliers, ratio, len(good)


def verify_candidate(
    query_frames,
    source_frames,
    offset,
    sift,
    matcher,
):
    source_by_time = {
        int(round(timestamp)):
        (
            timestamp,
            extract(frame, sift),
        )
        for timestamp, frame, _
        in source_frames
    }

    evidence = []

    for query_time, query_frame, _ in query_frames:
        query_feature = extract(
            query_frame,
            sift,
        )

        best = (
            0,
            0.0,
            0,
            None,
        )

        center = int(
            round(
                query_time + offset
            )
        )

        for source_time in (
            center - 1,
            center,
            center + 1,
        ):
            if source_time not in source_by_time:
                continue

            current = pair_score(
                query_feature,
                source_by_time[
                    source_time
                ][1],
                matcher,
            )

            if current > best[:3]:
                best = (
                    *current,
                    source_time,
                )

        if (
            best[0] >= 6
            and best[1] >= 0.55
        ):
            evidence.append(
                (
                    query_time,
                    *best,
                )
            )

    return evidence


def main():
    with tempfile.TemporaryDirectory(
        prefix="p106-v013-"
    ) as temp:
        root = Path(temp)
        videos = make_library(root)
        target = videos[2]

        query_dir = root / "queries"
        query_dir.mkdir()

        cases = {
            "vertical8.mp4":
            (
                "crop=202:360:"
                "(iw-202)/2:0,"
                "scale=360:640"
            ),
            "vertical_wm8.mp4":
            (
                "crop=202:360:"
                "(iw-202)/2:0,"
                "scale=360:640,"
                "drawbox="
                "x=iw*0.55:"
                "y=ih*0.78:"
                "w=iw*0.42:"
                "h=ih*0.15:"
                "color=black@0.45:t=fill"
            ),
            "crop50_wm8.mp4":
            (
                "crop="
                "iw*0.5:ih*0.5:"
                "(iw-iw*0.5)*0.7:"
                "(ih-ih*0.5)*0.2,"
                "scale=640:360,"
                "drawbox="
                "x=iw*0.60:"
                "y=ih*0.78:"
                "w=iw*0.35:"
                "h=ih*0.15:"
                "color=black@0.45:t=fill"
            ),
        }

        for name, filter_chain in cases.items():
            run(
                [
                    "ffmpeg",
                    "-y",
                    "-loglevel",
                    "error",
                    "-ss",
                    "7",
                    "-i",
                    str(target),
                    "-t",
                    "8",
                    "-vf",
                    filter_chain,
                    "-c:v",
                    "libx264",
                    "-crf",
                    "32",
                    "-preset",
                    "ultrafast",
                    "-an",
                    str(query_dir / name),
                ]
            )

        library = {
            path.name: sample_video(path)
            for path in videos
        }

        sift = cv2.SIFT_create(
            nfeatures=500,
            contrastThreshold=0.02,
            edgeThreshold=10,
            sigma=1.6,
        )
        matcher = cv2.BFMatcher(
            cv2.NORM_L2
        )

        for query_path in sorted(
            query_dir.glob("*.mp4")
        ):
            query = sample_video(
                query_path
            )

            pre_rank = []

            for source_name, source in library.items():
                pre_rank.append(
                    (
                        phash_candidate(
                            query,
                            source,
                        ),
                        source_name,
                    )
                )

            pre_rank.sort(reverse=True)

            print()
            print(
                "CASE",
                query_path.name,
            )
            print(
                "pHash top3",
                pre_rank[:3],
            )

            rerank = []

            for candidate, source_name in pre_rank[:3]:
                offset = candidate[2]

                evidence = verify_candidate(
                    query,
                    library[source_name],
                    offset,
                    sift,
                    matcher,
                )

                median_inliers = (
                    float(
                        np.median(
                            [
                                item[1]
                                for item
                                in evidence
                            ]
                        )
                    )
                    if evidence
                    else 0.0
                )

                median_ratio = (
                    float(
                        np.median(
                            [
                                item[2]
                                for item
                                in evidence
                            ]
                        )
                    )
                    if evidence
                    else 0.0
                )

                score = (
                    len(evidence) * 100
                    + median_inliers
                    + 20 * median_ratio
                )

                rerank.append(
                    (
                        score,
                        source_name,
                        len(evidence),
                        offset,
                        median_inliers,
                        median_ratio,
                    )
                )

            print(
                "SIFT rerank",
                sorted(
                    rerank,
                    reverse=True,
                ),
            )


if __name__ == "__main__":
    main()
