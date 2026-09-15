from __future__ import annotations

import argparse


def gibibytes(value):
    return value / 1024**3


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--hours",
        type=float,
        nargs="+",
        default=[
            1000,
            5000,
            10000,
            50000,
        ],
    )
    parser.add_argument(
        "--baseline-fps",
        type=float,
        default=1.0,
    )
    parser.add_argument(
        "--keyframe-interval",
        type=float,
        default=10.0,
    )
    parser.add_argument(
        "--visual-words",
        type=int,
        default=24,
    )
    parser.add_argument(
        "--posting-bytes",
        type=int,
        default=8,
    )
    parser.add_argument(
        "--thumb-bytes",
        type=int,
        default=6000,
    )
    parser.add_argument(
        "--chromaprint-entries-per-sec",
        type=float,
        default=172 / 24,
    )
    args = parser.parse_args()

    print(
        "hours,baseline_frames,"
        "baseline16B_GiB,"
        "28region_GiB,"
        "visual_postings_allframes_GiB,"
        "thumb_allframes_GiB,"
        "keyframes,"
        "keyframe_words_GiB,"
        "keyframe_thumb_GiB,"
        "chromaprint_raw_GiB"
    )

    for hours in args.hours:
        seconds = hours * 3600
        frames = int(
            seconds * args.baseline_fps
        )
        keyframes = int(
            seconds / args.keyframe_interval
        )

        baseline = frames * 16
        regions = frames * (
            8 + 28 * 8
        )
        all_postings = (
            frames
            * args.visual_words
            * args.posting_bytes
        )
        all_thumbnails = (
            frames
            * args.thumb_bytes
        )
        keyframe_postings = (
            keyframes
            * args.visual_words
            * args.posting_bytes
        )
        keyframe_thumbnails = (
            keyframes
            * args.thumb_bytes
        )
        audio = (
            seconds
            * args.chromaprint_entries_per_sec
            * 4
        )

        print(
            f"{hours:g},"
            f"{frames},"
            f"{gibibytes(baseline):.3f},"
            f"{gibibytes(regions):.3f},"
            f"{gibibytes(all_postings):.3f},"
            f"{gibibytes(all_thumbnails):.3f},"
            f"{keyframes},"
            f"{gibibytes(keyframe_postings):.3f},"
            f"{gibibytes(keyframe_thumbnails):.3f},"
            f"{gibibytes(audio):.3f}"
        )


if __name__ == "__main__":
    main()
