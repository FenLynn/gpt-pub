from __future__ import annotations

import argparse
import json
import math
import tempfile
import time
from pathlib import Path

import numpy as np


VOCAB_SIZE = 32_768
GLOBAL_VOCAB = 64
CLUSTER_SPACE = 8_192
CLUSTER_BASE = GLOBAL_VOCAB
UNIQUE_BASE = CLUSTER_BASE + CLUSTER_SPACE

WORDS_PER_IMAGE = 64
GLOBAL_WORDS = 12
CLUSTER_WORDS = 16
UNIQUE_WORDS = WORDS_PER_IMAGE - GLOBAL_WORDS - CLUSTER_WORDS

CLUSTER_SIZE = 50


def build_index(n_images: int, seed: int) -> tuple[dict, dict]:
    rng = np.random.default_rng(seed)
    started = time.perf_counter()

    global_part = rng.integers(
        0,
        GLOBAL_VOCAB,
        size=(n_images, GLOBAL_WORDS),
        dtype=np.uint16,
    )

    cluster_ids = (
        np.arange(n_images, dtype=np.uint64)
        // CLUSTER_SIZE
    )

    shifts = (
        (cluster_ids * np.uint64(2_654_435_761))
        % CLUSTER_SPACE
    ).astype(np.uint32)

    offsets = (
        np.arange(CLUSTER_WORDS, dtype=np.uint32)
        * np.uint32(503)
    ) % CLUSTER_SPACE

    cluster_part = (
        CLUSTER_BASE
        + (
            shifts[:, None]
            + offsets[None, :]
        )
        % CLUSTER_SPACE
    ).astype(np.uint16)

    unique_part = rng.integers(
        UNIQUE_BASE,
        VOCAB_SIZE,
        size=(n_images, UNIQUE_WORDS),
        dtype=np.uint16,
    )

    words = np.concatenate(
        [
            global_part,
            cluster_part,
            unique_part,
        ],
        axis=1,
    )

    words.sort(axis=1)

    keep = np.ones_like(words, dtype=bool)
    keep[:, 1:] = (
        words[:, 1:]
        != words[:, :-1]
    )

    flat_words = words[keep]

    counts_per_image = keep.sum(
        axis=1
    ).astype(np.int32)

    image_ids = np.repeat(
        np.arange(
            n_images,
            dtype=np.uint32,
        ),
        counts_per_image,
    )

    order = np.argsort(
        flat_words,
        kind="stable",
    )

    sorted_words = flat_words[order]
    postings = image_ids[order]

    counts = np.bincount(
        sorted_words.astype(np.int32),
        minlength=VOCAB_SIZE,
    ).astype(np.int64)

    word_offsets = np.zeros(
        VOCAB_SIZE + 1,
        dtype=np.int64,
    )
    word_offsets[1:] = np.cumsum(
        counts,
        dtype=np.int64,
    )

    idf = (
        np.log(
            (max(1, n_images) + 1.0)
            / (counts.astype(np.float64) + 1.0)
        )
        + 1.0
    ).astype(np.float32)

    stop = np.zeros(
        VOCAB_SIZE,
        dtype=np.uint8,
    )

    if n_images >= 100:
        stop[
            counts
            >= max(
                25,
                int(
                    math.ceil(
                        n_images * 0.15
                    )
                ),
            )
        ] = 1

    build_seconds = (
        time.perf_counter()
        - started
    )

    index = {
        "postings": postings,
        "offsets": word_offsets,
        "idf": idf,
        "stop": stop,
        "cluster_part": cluster_part,
        "unique_part": unique_part,
    }

    stats = {
        "images": int(n_images),
        "build_seconds": float(build_seconds),
        "mean_unique_words_per_image": float(
            counts_per_image.mean()
        ),
        "postings": int(len(postings)),
        "postings_mib": float(
            postings.nbytes / 1024**2
        ),
        "offsets_mib": float(
            word_offsets.nbytes / 1024**2
        ),
        "idf_mib": float(
            idf.nbytes / 1024**2
        ),
        "stop_mib": float(
            stop.nbytes / 1024**2
        ),
        "stop_words": int(
            np.count_nonzero(stop)
        ),
        "local_word_truth_payload_mib": float(
            n_images
            * WORDS_PER_IMAGE
            * 2
            / 1024**2
        ),
    }

    return index, stats


def search_arrays(
    postings: np.ndarray,
    offsets: np.ndarray,
    idf: np.ndarray,
    stop: np.ndarray,
    query_words: np.ndarray,
    top_k: int,
) -> tuple[np.ndarray, int]:
    words = np.unique(
        np.asarray(
            query_words,
            dtype=np.uint16,
        )
    )

    words = words[
        stop[
            words.astype(np.int32)
        ] == 0
    ]

    id_parts = []
    weight_parts = []
    touched = 0

    for word_value in words:
        word = int(word_value)
        begin = int(offsets[word])
        end = int(offsets[word + 1])

        if end <= begin:
            continue

        ids = np.asarray(
            postings[begin:end],
            dtype=np.uint32,
        )

        touched += len(ids)
        id_parts.append(ids)

        weight_parts.append(
            np.full(
                len(ids),
                float(idf[word]),
                dtype=np.float32,
            )
        )

    if not id_parts:
        return (
            np.empty(
                0,
                dtype=np.uint32,
            ),
            0,
        )

    all_ids = np.concatenate(id_parts)
    all_weights = np.concatenate(
        weight_parts
    )

    unique_ids, inverse = np.unique(
        all_ids,
        return_inverse=True,
    )

    scores = np.bincount(
        inverse,
        weights=all_weights,
    ).astype(np.float32)

    keep = min(
        max(1, int(top_k)),
        len(unique_ids),
    )

    if keep == len(unique_ids):
        order = np.argsort(
            scores
        )[::-1]
    else:
        order = np.argpartition(
            scores,
            -keep,
        )[-keep:]
        order = order[
            np.argsort(
                scores[order]
            )[::-1]
        ]

    return (
        unique_ids[order],
        touched,
    )


def make_query(
    index: dict,
    target: int,
    shared_unique_words: int,
    rng,
) -> np.ndarray:
    cluster_words = index[
        "cluster_part"
    ][target]

    unique_words = index[
        "unique_part"
    ][target]

    parts = [
        rng.choice(
            cluster_words,
            size=8,
            replace=False,
        ),
    ]

    if shared_unique_words:
        parts.append(
            rng.choice(
                unique_words,
                size=shared_unique_words,
                replace=False,
            )
        )

    parts.extend(
        [
            rng.integers(
                0,
                GLOBAL_VOCAB,
                size=4,
                dtype=np.uint16,
            ),
            rng.integers(
                UNIQUE_BASE,
                VOCAB_SIZE,
                size=8,
                dtype=np.uint16,
            ),
        ]
    )

    return np.concatenate(parts)


def benchmark_memory(
    index: dict,
    n_images: int,
    query_count: int,
    seed: int,
) -> dict:
    rng = np.random.default_rng(seed)

    targets = rng.choice(
        n_images,
        size=min(
            query_count,
            n_images,
        ),
        replace=False,
    )

    result = {}

    for shared_unique in (
        0,
        1,
        2,
        4,
    ):
        top5 = 0
        top20 = 0
        top50 = 0
        timings = []
        postings_touched = []

        for target in targets:
            query = make_query(
                index,
                int(target),
                shared_unique,
                rng,
            )

            started = time.perf_counter()

            ranked, touched = search_arrays(
                index["postings"],
                index["offsets"],
                index["idf"],
                index["stop"],
                query,
                50,
            )

            timings.append(
                (
                    time.perf_counter()
                    - started
                )
                * 1000
            )
            postings_touched.append(
                touched
            )

            top5 += int(
                target in ranked[:5]
            )
            top20 += int(
                target in ranked[:20]
            )
            top50 += int(
                target in ranked[:50]
            )

        result[
            f"shared_unique_{shared_unique}"
        ] = {
            "queries": int(
                len(targets)
            ),
            "top5": int(top5),
            "top20": int(top20),
            "top50": int(top50),
            "median_query_ms": float(
                np.median(timings)
            ),
            "p95_query_ms": float(
                np.percentile(
                    timings,
                    95,
                )
            ),
            "median_postings_touched": float(
                np.median(
                    postings_touched
                )
            ),
            "p95_postings_touched": float(
                np.percentile(
                    postings_touched,
                    95,
                )
            ),
        }

    return result


def benchmark_mmap(
    index: dict,
    n_images: int,
    query_count: int,
    seed: int,
) -> dict:
    rng = np.random.default_rng(seed)

    targets = rng.choice(
        n_images,
        size=min(
            query_count,
            n_images,
        ),
        replace=False,
    )

    with tempfile.TemporaryDirectory(
        prefix="p106-r017-"
    ) as temp:
        root = Path(temp)

        for name in (
            "postings",
            "offsets",
            "idf",
            "stop",
        ):
            np.save(
                root / f"{name}.npy",
                index[name],
            )

        timings = []
        touched_values = []
        top20 = 0
        top50 = 0

        for target in targets:
            query = make_query(
                index,
                int(target),
                1,
                rng,
            )

            started = time.perf_counter()

            postings = np.load(
                root / "postings.npy",
                mmap_mode="r",
            )
            offsets = np.load(
                root / "offsets.npy",
                mmap_mode="r",
            )
            idf = np.load(
                root / "idf.npy",
                mmap_mode="r",
            )
            stop = np.load(
                root / "stop.npy",
                mmap_mode="r",
            )

            ranked, touched = search_arrays(
                postings,
                offsets,
                idf,
                stop,
                query,
                50,
            )

            timings.append(
                (
                    time.perf_counter()
                    - started
                )
                * 1000
            )
            touched_values.append(
                touched
            )

            top20 += int(
                target in ranked[:20]
            )
            top50 += int(
                target in ranked[:50]
            )

        return {
            "queries": int(
                len(targets)
            ),
            "shared_unique_words": 1,
            "top20": int(top20),
            "top50": int(top50),
            "median_query_ms": float(
                np.median(timings)
            ),
            "p95_query_ms": float(
                np.percentile(
                    timings,
                    95,
                )
            ),
            "median_postings_touched": float(
                np.median(
                    touched_values
                )
            ),
            "p95_postings_touched": float(
                np.percentile(
                    touched_values,
                    95,
                )
            ),
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--images",
        type=int,
        nargs="+",
        default=[
            10_000,
            100_000,
            500_000,
        ],
    )
    parser.add_argument(
        "--queries",
        type=int,
        default=100,
    )
    parser.add_argument(
        "--mmap-queries",
        type=int,
        default=200,
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=106,
    )
    parser.add_argument(
        "--output",
        default="",
    )
    args = parser.parse_args()

    runs = []

    for n_images in args.images:
        index, stats = build_index(
            n_images,
            args.seed,
        )

        memory = benchmark_memory(
            index,
            n_images,
            args.queries,
            args.seed + 1,
        )

        item = {
            "stats": stats,
            "memory_query": memory,
        }

        if n_images == max(
            args.images
        ):
            item["mmap_query"] = (
                benchmark_mmap(
                    index,
                    n_images,
                    args.mmap_queries,
                    args.seed + 2,
                )
            )

        runs.append(item)

    payload = {
        "ok": True,
        "model": {
            "vocab_size": VOCAB_SIZE,
            "words_per_image": WORDS_PER_IMAGE,
            "cluster_size": CLUSTER_SIZE,
            "global_words_per_image": GLOBAL_WORDS,
            "cluster_words_per_image": CLUSTER_WORDS,
            "unique_words_per_image": UNIQUE_WORDS,
            "note": (
                "Synthetic structural scale benchmark. "
                "It mirrors production dtypes, stop-word logic, "
                "IDF scoring and mmap access, but it does not "
                "measure real-image recall."
            ),
        },
        "runs": runs,
    }

    rendered = json.dumps(
        payload,
        ensure_ascii=False,
        indent=2,
    )

    print(rendered)

    if args.output:
        Path(args.output).write_text(
            rendered,
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
