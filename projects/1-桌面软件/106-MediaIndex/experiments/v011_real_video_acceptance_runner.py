from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import cv2
import numpy as np


VIDEO_EXTS = {
    ".mp4", ".mkv", ".mov", ".avi", ".webm",
    ".m4v", ".ts", ".mts", ".m2ts",
}


def phash64(frame: np.ndarray) -> np.uint64:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(
        gray, (32, 32), interpolation=cv2.INTER_AREA
    ).astype(np.float32)
    values = cv2.dct(small)[:8, :8].ravel()
    median = np.median(values[1:])

    output = np.uint64(0)
    for index, value in enumerate(values > median):
        if value:
            output |= np.uint64(1) << np.uint64(index)
    return output


def sample_video(path: Path, interval: float):
    capture = cv2.VideoCapture(str(path))
    fps = capture.get(cv2.CAP_PROP_FPS)
    count = capture.get(cv2.CAP_PROP_FRAME_COUNT)

    if not fps or fps <= 0 or not count or count <= 0:
        capture.release()
        return np.empty(0), np.empty(0, dtype=np.uint64)

    duration = count / fps
    times = []
    hashes = []

    for timestamp in np.arange(0, duration - 1e-6, interval):
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


def fit_model(
    query_times,
    query_hashes,
    source_times,
    source_hashes,
    distance_threshold,
    residual_threshold,
):
    if len(query_hashes) < 2 or len(source_hashes) < 2:
        return {
            "score": -9.0,
            "inliers": 0,
            "fraction": 0.0,
            "offset": None,
            "scale": None,
            "median_hamming": 99.0,
        }

    distance = np.bitwise_count(
        query_hashes[:, None] ^ source_hashes[None, :]
    ).astype(np.int16)

    best_source = distance.argmin(axis=1)
    best_distance = distance[
        np.arange(len(query_hashes)),
        best_source,
    ]

    points = np.asarray(
        [
            (
                query_times[index],
                source_times[best_source[index]],
                best_distance[index],
            )
            for index in range(len(query_hashes))
            if best_distance[index] <= distance_threshold
        ],
        dtype=float,
    )

    if len(points) < 2:
        return {
            "score": -9.0,
            "inliers": 0,
            "fraction": 0.0,
            "offset": None,
            "scale": None,
            "median_hamming": 99.0,
        }

    best = None

    for first in range(len(points)):
        for second in range(first + 1, len(points)):
            q1, s1 = points[first, :2]
            q2, s2 = points[second, :2]

            if abs(q2 - q1) < 1e-9:
                continue

            scale = (s2 - s1) / (q2 - q1)
            if not 0.85 <= scale <= 1.15:
                continue

            offset = s1 - scale * q1
            residual = np.abs(
                points[:, 1]
                - (scale * points[:, 0] + offset)
            )
            mask = residual <= residual_threshold
            count = int(mask.sum())

            if count < 2:
                continue

            median_hamming = float(
                np.median(points[mask, 2])
            )
            key = (
                count,
                -median_hamming,
                -abs(scale - 1.0),
            )

            if best is None or key > best[0]:
                best = (
                    key,
                    count,
                    median_hamming,
                    float(scale),
                    float(offset),
                )

    if best is None:
        return {
            "score": -9.0,
            "inliers": 0,
            "fraction": 0.0,
            "offset": None,
            "scale": None,
            "median_hamming": 99.0,
        }

    _, count, median_hamming, scale, offset = best
    fraction = count / max(1, len(query_hashes))

    return {
        "score": float(
            fraction - median_hamming / 128.0
        ),
        "inliers": count,
        "fraction": float(fraction),
        "offset": offset,
        "scale": scale,
        "median_hamming": median_hamming,
    }


def resolve_query(raw: str, manifest: Path) -> Path:
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = manifest.parent / path
    return path.resolve()


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "P106 V011 small-domain video baseline runner"
        )
    )
    parser.add_argument("--library", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--interval", type=float, default=1.0)
    parser.add_argument(
        "--output",
        default="v011_results.json",
    )
    args = parser.parse_args()

    root = Path(args.library).resolve()
    manifest = Path(args.manifest).resolve()

    videos = sorted(
        [
            path
            for path in root.rglob("*")
            if path.is_file()
            and path.suffix.lower() in VIDEO_EXTS
        ]
    )

    if not videos:
        raise SystemExit("No library videos found")

    sequences = {
        path.relative_to(root).as_posix():
        sample_video(path, args.interval)
        for path in videos
    }

    rows = list(
        csv.DictReader(
            manifest.open(
                "r",
                encoding="utf-8-sig",
                newline="",
            )
        )
    )

    results = []

    for row in rows:
        query = resolve_query(row["query"], manifest)
        expected = (
            row.get("expected_source", "")
            .replace("\\", "/")
            .strip()
            .lstrip("./")
        )
        expected_start = (
            float(row["expected_start_sec"])
            if row.get("expected_start_sec")
            else None
        )

        query_times, query_hashes = sample_video(
            query,
            args.interval,
        )

        candidates = []

        for source_name, (
            source_times,
            source_hashes,
        ) in sequences.items():
            result = fit_model(
                query_times,
                query_hashes,
                source_times,
                source_hashes,
                distance_threshold=18,
                residual_threshold=max(
                    0.55,
                    args.interval * 0.65,
                ),
            )
            candidates.append(
                (
                    result,
                    source_name,
                )
            )

        candidates.sort(
            key=lambda item: item[0]["score"],
            reverse=True,
        )

        top = candidates[0]
        second = (
            candidates[1]
            if len(candidates) > 1
            else (
                {"score": -9.0},
                "",
            )
        )

        margin = (
            top[0]["score"]
            - second[0]["score"]
        )
        is_positive = bool(expected)
        strong_match_baseline = (
            top[0]["inliers"] >= 3
            and top[0]["fraction"] >= 0.50
            and top[0]["median_hamming"] <= 12
            and top[0]["score"] >= 0.35
            and margin >= 0.05
        )

        record = {
            "query": query.name,
            "expected_source": expected,
            "is_positive": is_positive,
            "top1_source": top[1],
            "correct_top1": (
                top[1] == expected
                if is_positive
                else None
            ),
            "relation": row.get("relation", ""),
            "inliers": top[0]["inliers"],
            "fraction": top[0]["fraction"],
            "estimated_offset_sec": top[0]["offset"],
            "estimated_scale": top[0]["scale"],
            "median_hamming": top[0]["median_hamming"],
            "score": top[0]["score"],
            "margin_to_second": margin,
            "strong_match_baseline": bool(strong_match_baseline),
            "unexpected_strong_match_baseline": bool(
                (not is_positive)
                and strong_match_baseline
            ),
        }

        if (
            expected_start is not None
            and top[0]["offset"] is not None
        ):
            record["start_abs_error_sec"] = abs(
                top[0]["offset"]
                - expected_start
            )

        results.append(record)

    positives = [
        record
        for record in results
        if record["is_positive"]
    ]
    negatives = [
        record
        for record in results
        if not record["is_positive"]
    ]

    correct = sum(
        bool(record["correct_top1"])
        for record in positives
    )

    start_errors = [
        record["start_abs_error_sec"]
        for record in positives
        if "start_abs_error_sec" in record
    ]

    unexpected_strong = sum(
        record["unexpected_strong_match_baseline"]
        for record in negatives
    )

    summary = {
        "queries": len(results),
        "positive_queries": len(positives),
        "negative_queries": len(negatives),
        "top1_correct_positive": correct,
        "top1_accuracy_positive": (
            correct / max(1, len(positives))
        ),
        "unexpected_strong_match_count_baseline": (
            unexpected_strong
        ),
        "unexpected_strong_match_rate_baseline": (
            unexpected_strong / max(1, len(negatives))
        ),
        "median_margin_positive": (
            float(
                np.median(
                    [
                        record["margin_to_second"]
                        for record in positives
                    ]
                )
            )
            if positives
            else None
        ),
        "median_start_abs_error_sec": (
            float(np.median(start_errors))
            if start_errors
            else None
        ),
        "note": (
            "Baseline pHash temporal runner only. "
            "No local-feature Lane B, Composite "
            "piecewise alignment, or Audio Lane C. "
            "The strong-match threshold is exploratory, "
            "not production-frozen."
        ),
    }

    Path(args.output).write_text(
        json.dumps(
            {
                "summary": summary,
                "results": results,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        json.dumps(
            summary,
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
