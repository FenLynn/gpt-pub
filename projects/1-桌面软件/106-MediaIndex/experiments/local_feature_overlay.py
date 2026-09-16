from __future__ import annotations

import os
import time
from pathlib import Path

import numpy as np

import local_feature_index as base_index


DELTA_POSTINGS = "local_delta_postings.npy"
DELTA_OFFSETS = "local_delta_offsets.npy"
OVERRIDE_IDS = "local_override_ids.npy"

DELTA_FILES = (
    DELTA_POSTINGS,
    DELTA_OFFSETS,
    OVERRIDE_IDS,
)


def _save_array(
    index_dir: Path,
    filename: str,
    array: np.ndarray,
) -> None:
    target = index_dir / filename
    temp = index_dir / (
        target.stem + ".tmp.npy"
    )

    np.save(temp, array)
    os.replace(temp, target)


def clear_overlay(index_dir: Path) -> None:
    for filename in DELTA_FILES:
        path = index_dir / filename
        try:
            if path.exists():
                path.unlink()
        except OSError:
            pass


def load_override_ids(index_dir: Path) -> np.ndarray:
    path = index_dir / OVERRIDE_IDS

    if not path.is_file():
        return np.empty(
            0,
            dtype=np.uint32,
        )

    values = np.load(
        path,
        mmap_mode="r",
    )

    return np.asarray(
        values,
        dtype=np.uint32,
    ).copy()


def overlay_available(index_dir: Path) -> bool:
    return all(
        (index_dir / filename).is_file()
        for filename in DELTA_FILES
    )


def _build_postings(
    entries: list[tuple[int, bytes | None]],
) -> tuple[np.ndarray, np.ndarray]:
    total_words = sum(
        len(blob or b"") // 2
        for _, blob in entries
    )

    if total_words == 0:
        postings = np.empty(
            0,
            dtype=np.uint32,
        )
        offsets = np.zeros(
            base_index.VOCAB_SIZE + 1,
            dtype=np.int64,
        )
        return postings, offsets

    flat_words = np.empty(
        total_words,
        dtype=np.uint16,
    )
    flat_ids = np.empty(
        total_words,
        dtype=np.uint32,
    )

    cursor = 0

    for image_id, blob in entries:
        words = base_index.blob_to_words(
            blob
        )
        count = len(words)

        if count == 0:
            continue

        end = cursor + count
        flat_words[cursor:end] = words
        flat_ids[cursor:end] = np.uint32(
            image_id
        )
        cursor = end

    flat_words = flat_words[:cursor]
    flat_ids = flat_ids[:cursor]

    if cursor == 0:
        postings = np.empty(
            0,
            dtype=np.uint32,
        )
        offsets = np.zeros(
            base_index.VOCAB_SIZE + 1,
            dtype=np.int64,
        )
        return postings, offsets

    order = np.argsort(
        flat_words,
        kind="stable",
    )

    sorted_words = flat_words[order]
    postings = flat_ids[order]

    counts = np.bincount(
        sorted_words.astype(np.int32),
        minlength=base_index.VOCAB_SIZE,
    ).astype(np.int64)

    offsets = np.zeros(
        base_index.VOCAB_SIZE + 1,
        dtype=np.int64,
    )
    offsets[1:] = np.cumsum(
        counts,
        dtype=np.int64,
    )

    return postings, offsets


def build_overlay(
    index_dir: Path,
    entries: list[tuple[int, bytes | None]],
    override_ids: np.ndarray,
) -> dict:
    started = time.perf_counter()

    postings, offsets = _build_postings(
        entries
    )

    overrides = np.unique(
        np.asarray(
            override_ids,
            dtype=np.uint32,
        )
    )

    _save_array(
        index_dir,
        DELTA_POSTINGS,
        postings,
    )
    _save_array(
        index_dir,
        DELTA_OFFSETS,
        offsets,
    )
    _save_array(
        index_dir,
        OVERRIDE_IDS,
        overrides,
    )

    return {
        "local_delta_postings": int(
            len(postings)
        ),
        "local_delta_postings_bytes": int(
            postings.nbytes
        ),
        "local_delta_override_count": int(
            len(overrides)
        ),
        "local_delta_build_seconds": float(
            time.perf_counter()
            - started
        ),
    }


def _is_masked(
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


def _search_arrays(
    postings: np.ndarray,
    offsets: np.ndarray,
    idf: np.ndarray,
    stop: np.ndarray,
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
            np.empty(
                0,
                dtype=np.float32,
            ),
            touched,
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

    if (
        exclude_ids is not None
        and len(exclude_ids)
    ):
        drop = _is_masked(
            unique_ids,
            exclude_ids,
        )
        unique_ids = unique_ids[~drop]
        scores = scores[~drop]

    if len(unique_ids) == 0:
        return (
            unique_ids,
            scores,
            touched,
        )

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
        scores[order],
        touched,
    )


def _merge(
    left: tuple[
        np.ndarray,
        np.ndarray,
        int,
    ],
    right: tuple[
        np.ndarray,
        np.ndarray,
        int,
    ],
    top_k: int,
) -> tuple[np.ndarray, np.ndarray]:
    ids = np.concatenate(
        [
            left[0],
            right[0],
        ]
    )
    scores = np.concatenate(
        [
            left[1],
            right[1],
        ]
    )

    if len(ids) == 0:
        return (
            np.empty(
                0,
                dtype=np.uint32,
            ),
            np.empty(
                0,
                dtype=np.float32,
            ),
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

    return (
        unique_ids[order],
        merged_scores[order],
    )


def search_index(
    index_dir: Path,
    query_words: np.ndarray,
    top_k: int,
) -> tuple[np.ndarray, np.ndarray, dict]:
    started = time.perf_counter()

    if not overlay_available(index_dir):
        ids, scores, meta = (
            base_index.search_index(
                index_dir,
                query_words,
                top_k,
            )
        )
        return (
            ids,
            scores,
            {
                **meta,
                "overlay": False,
                "base_postings_touched": int(
                    meta.get(
                        "postings_touched",
                        0,
                    )
                ),
                "delta_postings_touched": 0,
                "override_count": 0,
            },
        )

    idf = np.load(
        index_dir / "local_idf.npy",
        mmap_mode="r",
    )
    stop = np.load(
        index_dir / "local_stop.npy",
        mmap_mode="r",
    )

    base_postings = np.load(
        index_dir / "local_postings.npy",
        mmap_mode="r",
    )
    base_offsets = np.load(
        index_dir / "local_offsets.npy",
        mmap_mode="r",
    )

    delta_postings = np.load(
        index_dir / DELTA_POSTINGS,
        mmap_mode="r",
    )
    delta_offsets = np.load(
        index_dir / DELTA_OFFSETS,
        mmap_mode="r",
    )
    overrides = np.load(
        index_dir / OVERRIDE_IDS,
        mmap_mode="r",
    )

    base_result = _search_arrays(
        base_postings,
        base_offsets,
        idf,
        stop,
        query_words,
        top_k,
        exclude_ids=overrides,
    )

    delta_result = _search_arrays(
        delta_postings,
        delta_offsets,
        idf,
        stop,
        query_words,
        top_k,
    )

    ids, scores = _merge(
        base_result,
        delta_result,
        top_k,
    )

    elapsed_ms = (
        time.perf_counter()
        - started
    ) * 1000

    return (
        ids,
        scores,
        {
            "query_words": int(
                len(query_words)
            ),
            "usable_words": int(
                len(
                    np.unique(
                        np.asarray(
                            query_words,
                            dtype=np.uint16,
                        )
                    )
                )
            ),
            "postings_touched": int(
                base_result[2]
                + delta_result[2]
            ),
            "base_postings_touched": int(
                base_result[2]
            ),
            "delta_postings_touched": int(
                delta_result[2]
            ),
            "override_count": int(
                len(overrides)
            ),
            "overlay": True,
            "query_ms": float(
                elapsed_ms
            ),
        },
    )
