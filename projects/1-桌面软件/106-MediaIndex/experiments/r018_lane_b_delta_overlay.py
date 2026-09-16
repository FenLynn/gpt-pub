from __future__ import annotations

import argparse
import json
import math
import time

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


def make_words(
    image_ids: np.ndarray,
    seed: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    ids = np.asarray(
        image_ids,
        dtype=np.uint64,
    )

    n_images = len(ids)

    global_part = rng.integers(
        0,
        GLOBAL_VOCAB,
        size=(n_images, GLOBAL_WORDS),
        dtype=np.uint16,
    )

    cluster_ids = ids // CLUSTER_SIZE

    shifts = (
        (
            cluster_ids
            * np.uint64(2_654_435_761)
        )
        % CLUSTER_SPACE
    ).astype(np.uint32)

    offsets = (
        np.arange(
            CLUSTER_WORDS,
            dtype=np.uint32,
        )
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

    return (
        words,
        cluster_part,
        unique_part,
    )


def build_index(
    words: np.ndarray,
    image_ids: np.ndarray,
    collection_size: int,
    *,
    frozen_idf: np.ndarray | None = None,
    frozen_stop: np.ndarray | None = None,
) -> dict:
    started = time.perf_counter()

    keep = np.ones_like(
        words,
        dtype=bool,
    )

    keep[:, 1:] = (
        words[:, 1:]
        != words[:, :-1]
    )

    flat_words = words[keep]

    counts_per_image = keep.sum(
        axis=1
    ).astype(np.int32)

    postings_ids = np.repeat(
        np.asarray(
            image_ids,
            dtype=np.uint32,
        ),
        counts_per_image,
    )

    order = np.argsort(
        flat_words,
        kind="stable",
    )

    sorted_words = flat_words[order]
    postings = postings_ids[order]

    counts = np.bincount(
        sorted_words.astype(np.int32),
        minlength=VOCAB_SIZE,
    ).astype(np.int64)

    offsets = np.zeros(
        VOCAB_SIZE + 1,
        dtype=np.int64,
    )

    offsets[1:] = np.cumsum(
        counts,
        dtype=np.int64,
    )

    if frozen_idf is None:
        idf = (
            np.log(
                (max(1, collection_size) + 1.0)
                / (
                    counts.astype(np.float64)
                    + 1.0
                )
            )
            + 1.0
        ).astype(np.float32)
    else:
        idf = frozen_idf

    if frozen_stop is None:
        stop = np.zeros(
            VOCAB_SIZE,
            dtype=np.uint8,
        )

        if collection_size >= 100:
            stop[
                counts
                >= max(
                    25,
                    int(
                        math.ceil(
                            collection_size
                            * 0.15
                        )
                    ),
                )
            ] = 1
    else:
        stop = frozen_stop

    return {
        "postings": postings,
        "offsets": offsets,
        "idf": idf,
        "stop": stop,
        "build_seconds": float(
            time.perf_counter()
            - started
        ),
    }


def masked_ids(
    unique_ids: np.ndarray,
    mask_ids: np.ndarray,
) -> np.ndarray:
    if len(mask_ids) == 0:
        return np.zeros(
            len(unique_ids),
            dtype=bool,
        )

    positions = np.searchsorted(
        mask_ids,
        unique_ids,
    )

    valid = positions < len(mask_ids)

    clipped = np.minimum(
        positions,
        len(mask_ids) - 1,
    )

    return (
        valid
        & (
            mask_ids[clipped]
            == unique_ids
        )
    )


def search_index(
    index: dict,
    query_words: np.ndarray,
    top_k: int,
    *,
    exclude_ids: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray, int]:
    words = np.unique(
        np.asarray(
            query_words,
            dtype=np.uint16,
        )
    )

    words = words[
        index["stop"][
            words.astype(np.int32)
        ] == 0
    ]

    id_parts = []
    weight_parts = []
    touched = 0

    for word_value in words:
        word = int(word_value)

        begin = int(
            index["offsets"][word]
        )
        end = int(
            index["offsets"][
                word + 1
            ]
        )

        if end <= begin:
            continue

        ids = np.asarray(
            index["postings"][
                begin:end
            ],
            dtype=np.uint32,
        )

        touched += len(ids)

        id_parts.append(ids)
        weight_parts.append(
            np.full(
                len(ids),
                float(
                    index["idf"][word]
                ),
                dtype=np.float32,
            )
        )

    if not id_parts:
        return (
            np.empty(
                0,
                dtype=np.uint32,
            ),
            np.empty(
                0,
                dtype=np.float32,
            ),
            0,
        )

    all_ids = np.concatenate(
        id_parts
    )

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

    if (
        exclude_ids is not None
        and len(exclude_ids)
    ):
        drop = masked_ids(
            unique_ids,
            exclude_ids,
        )
        unique_ids = unique_ids[~drop]
        scores = scores[~drop]

    keep = min(
        max(1, int(top_k)),
        len(unique_ids),
    )

    if keep == 0:
        return (
            unique_ids,
            scores,
            touched,
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
        scores[order],
        touched,
    )


def merge_results(
    base: tuple[
        np.ndarray,
        np.ndarray,
        int,
    ],
    delta: tuple[
        np.ndarray,
        np.ndarray,
        int,
    ],
    top_k: int,
) -> np.ndarray:
    ids = np.concatenate(
        [
            base[0],
            delta[0],
        ]
    )

    scores = np.concatenate(
        [
            base[1],
            delta[1],
        ]
    )

    if len(ids) == 0:
        return np.empty(
            0,
            dtype=np.uint32,
        )

    unique_ids, inverse = np.unique(
        ids,
        return_inverse=True,
    )

    merged_scores = np.bincount(
        inverse,
        weights=scores,
    ).astype(np.float32)

    keep = min(
        max(1, int(top_k)),
        len(unique_ids),
    )

    if keep == len(unique_ids):
        order = np.argsort(
            merged_scores
        )[::-1]
    else:
        order = np.argpartition(
            merged_scores,
            -keep,
        )[-keep:]

        order = order[
            np.argsort(
                merged_scores[order]
            )[::-1]
        ]

    return unique_ids[order]


def make_query(
    cluster_words: np.ndarray,
    unique_words: np.ndarray,
    rng,
) -> np.ndarray:
    return np.concatenate(
        [
            rng.choice(
                cluster_words,
                size=8,
                replace=False,
            ),
            rng.choice(
                unique_words,
                size=1,
                replace=False,
            ),
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


def benchmark_base(
    base_index: dict,
    cluster_words: np.ndarray,
    unique_words: np.ndarray,
    query_count: int,
    seed: int,
) -> dict:
    rng = np.random.default_rng(seed)

    targets = rng.choice(
        len(cluster_words),
        size=query_count,
        replace=False,
    )

    timings = []
    touched = []
    top5 = 0
    top20 = 0

    for target in targets:
        query = make_query(
            cluster_words[target],
            unique_words[target],
            rng,
        )

        started = time.perf_counter()

        ranked, _, count = (
            search_index(
                base_index,
                query,
                50,
            )
        )

        timings.append(
            (
                time.perf_counter()
                - started
            )
            * 1000
        )

        touched.append(count)

        top5 += int(
            target in ranked[:5]
        )

        top20 += int(
            target in ranked[:20]
        )

    return {
        "queries": int(query_count),
        "top5": int(top5),
        "top20": int(top20),
        "median_ms": float(
            np.median(timings)
        ),
        "p95_ms": float(
            np.percentile(
                timings,
                95,
            )
        ),
        "median_postings_touched": float(
            np.median(touched)
        ),
    }


def benchmark_overlay(
    *,
    base_index: dict,
    base_cluster: np.ndarray,
    base_unique: np.ndarray,
    base_size: int,
    fraction: float,
    query_count: int,
    seed: int,
) -> dict:
    rng = np.random.default_rng(
        seed
        + int(
            round(
                fraction * 1_000_000
            )
        )
    )

    touched_ids = max(
        10,
        int(
            round(
                base_size * fraction
            )
        ),
    )

    updates = int(
        round(
            touched_ids * 0.70
        )
    )

    additions = int(
        round(
            touched_ids * 0.20
        )
    )

    deletions = (
        touched_ids
        - updates
        - additions
    )

    existing = rng.choice(
        base_size,
        size=updates + deletions,
        replace=False,
    ).astype(np.uint32)

    update_ids = np.sort(
        existing[:updates]
    )

    delete_ids = np.sort(
        existing[updates:]
    )

    new_ids = np.arange(
        base_size,
        base_size + additions,
        dtype=np.uint32,
    )

    delta_ids = np.concatenate(
        [
            update_ids,
            new_ids,
        ]
    )

    (
        delta_words,
        delta_cluster,
        delta_unique,
    ) = make_words(
        delta_ids,
        seed + 77,
    )

    current_collection_size = (
        base_size
        + additions
        - deletions
    )

    delta_index = build_index(
        delta_words,
        delta_ids,
        current_collection_size,
        frozen_idf=base_index[
            "idf"
        ],
        frozen_stop=base_index[
            "stop"
        ],
    )

    override_or_delete = np.sort(
        np.concatenate(
            [
                update_ids,
                delete_ids,
            ]
        )
    )

    delta_row = {
        int(image_id): row
        for row, image_id
        in enumerate(delta_ids)
    }

    each = max(
        1,
        query_count // 4,
    )

    def sample(
        values: np.ndarray,
    ) -> list[int]:
        if len(values) == 0:
            return []

        return [
            int(value)
            for value in rng.choice(
                values,
                size=each,
                replace=(
                    len(values)
                    < each
                ),
            )
        ]

    masked_set = set(
        int(value)
        for value
        in override_or_delete
    )

    unchanged = []

    while len(unchanged) < each:
        candidates = rng.integers(
            0,
            base_size,
            size=each * 2,
        )

        for candidate in candidates:
            value = int(candidate)

            if value in masked_set:
                continue

            unchanged.append(value)

            if len(unchanged) >= each:
                break

    updated = sample(update_ids)
    added = sample(new_ids)
    deleted = sample(delete_ids)

    timings = []
    base_touched = []
    delta_touched = []

    top5 = {
        "unchanged": 0,
        "updated": 0,
        "new": 0,
    }

    top20 = {
        "unchanged": 0,
        "updated": 0,
        "new": 0,
    }

    deleted_absent = 0

    def run_query(
        query: np.ndarray,
        target: int,
        kind: str,
    ) -> None:
        nonlocal deleted_absent

        started = time.perf_counter()

        base_result = search_index(
            base_index,
            query,
            50,
            exclude_ids=override_or_delete,
        )

        delta_result = search_index(
            delta_index,
            query,
            50,
        )

        ranked = merge_results(
            base_result,
            delta_result,
            50,
        )

        timings.append(
            (
                time.perf_counter()
                - started
            )
            * 1000
        )

        base_touched.append(
            base_result[2]
        )

        delta_touched.append(
            delta_result[2]
        )

        if kind == "deleted":
            deleted_absent += int(
                target not in ranked
            )
            return

        top5[kind] += int(
            target in ranked[:5]
        )

        top20[kind] += int(
            target in ranked[:20]
        )

    for target in unchanged:
        run_query(
            make_query(
                base_cluster[target],
                base_unique[target],
                rng,
            ),
            target,
            "unchanged",
        )

    for target in updated:
        row = delta_row[target]

        run_query(
            make_query(
                delta_cluster[row],
                delta_unique[row],
                rng,
            ),
            target,
            "updated",
        )

    for target in added:
        row = delta_row[target]

        run_query(
            make_query(
                delta_cluster[row],
                delta_unique[row],
                rng,
            ),
            target,
            "new",
        )

    for target in deleted:
        run_query(
            make_query(
                base_cluster[target],
                base_unique[target],
                rng,
            ),
            target,
            "deleted",
        )

    return {
        "fraction": float(fraction),
        "touched_ids": int(touched_ids),
        "updates": int(updates),
        "new": int(additions),
        "deletes": int(deletions),
        "delta_postings": int(
            len(
                delta_index[
                    "postings"
                ]
            )
        ),
        "delta_postings_mib": float(
            delta_index[
                "postings"
            ].nbytes
            / 1024**2
        ),
        "override_delete_mib": float(
            override_or_delete.nbytes
            / 1024**2
        ),
        "delta_build_seconds": float(
            delta_index[
                "build_seconds"
            ]
        ),
        "queries_each_class": int(
            each
        ),
        "top5": top5,
        "top20": top20,
        "deleted_absent": int(
            deleted_absent
        ),
        "median_ms": float(
            np.median(timings)
        ),
        "p95_ms": float(
            np.percentile(
                timings,
                95,
            )
        ),
        "median_base_postings_touched": float(
            np.median(
                base_touched
            )
        ),
        "median_delta_postings_touched": float(
            np.median(
                delta_touched
            )
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--images",
        type=int,
        default=500_000,
    )

    parser.add_argument(
        "--fractions",
        type=float,
        nargs="+",
        default=[
            0.001,
            0.01,
            0.05,
        ],
    )

    parser.add_argument(
        "--queries",
        type=int,
        default=240,
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

    base_ids = np.arange(
        args.images,
        dtype=np.uint32,
    )

    (
        base_words,
        base_cluster,
        base_unique,
    ) = make_words(
        base_ids,
        args.seed,
    )

    base_index = build_index(
        base_words,
        base_ids,
        args.images,
    )

    baseline = benchmark_base(
        base_index,
        base_cluster,
        base_unique,
        args.queries,
        args.seed + 1,
    )

    overlays = [
        benchmark_overlay(
            base_index=base_index,
            base_cluster=base_cluster,
            base_unique=base_unique,
            base_size=args.images,
            fraction=fraction,
            query_count=args.queries,
            seed=args.seed + 10,
        )
        for fraction in args.fractions
    ]

    payload = {
        "ok": True,
        "model": {
            "base_images": int(
                args.images
            ),
            "vocab_size": VOCAB_SIZE,
            "words_per_image": WORDS_PER_IMAGE,
            "update_mix": {
                "updated": 0.70,
                "new": 0.20,
                "deleted": 0.10,
            },
            "architecture": (
                "immutable base inverted index "
                "+ delta inverted overlay "
                "+ sorted override/delete IDs"
            ),
            "note": (
                "Synthetic structural benchmark. "
                "Frozen base IDF/stop words are "
                "reused by the delta until compaction."
            ),
        },
        "base": {
            "postings": int(
                len(
                    base_index[
                        "postings"
                    ]
                )
            ),
            "postings_mib": float(
                base_index[
                    "postings"
                ].nbytes
                / 1024**2
            ),
            "build_seconds": float(
                base_index[
                    "build_seconds"
                ]
            ),
            **baseline,
        },
        "overlays": overlays,
    }

    rendered = json.dumps(
        payload,
        ensure_ascii=False,
        indent=2,
    )

    print(rendered)

    if args.output:
        from pathlib import Path

        Path(
            args.output
        ).write_text(
            rendered,
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
