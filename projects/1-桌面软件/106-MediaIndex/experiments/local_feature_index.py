from __future__ import annotations

import hashlib
import math
import os
import time
from pathlib import Path

import cv2
import numpy as np


TABLES = 8
WORD_BITS = 12
BUCKETS_PER_TABLE = 1 << WORD_BITS
VOCAB_SIZE = TABLES * BUCKETS_PER_TABLE
WORDS_PER_IMAGE = 64
MAX_DESCRIPTORS = 128
MAX_IMAGE_DIM = 1400

INDEX_FILENAMES = (
    "local_postings.npy",
    "local_offsets.npy",
    "local_idf.npy",
    "local_stop.npy",
)


def _bit_positions() -> np.ndarray:
    rows = []

    for table in range(TABLES):
        selected = []
        used = set()
        counter = 0

        while len(selected) < WORD_BITS:
            digest = hashlib.sha256(
                f"P106-local-lsh:{table}:{counter}".encode("ascii")
            ).digest()
            counter += 1

            for value in digest:
                position = int(value)
                if position in used:
                    continue
                used.add(position)
                selected.append(position)
                if len(selected) >= WORD_BITS:
                    break

        rows.append(selected)

    return np.asarray(rows, dtype=np.int16)


BIT_POSITIONS = _bit_positions()
BIT_WEIGHTS = (
    np.uint32(1)
    << np.arange(WORD_BITS, dtype=np.uint32)
)


def create_orb():
    return cv2.ORB_create(
        nfeatures=1600,
        scaleFactor=1.2,
        nlevels=8,
        edgeThreshold=15,
        patchSize=31,
        fastThreshold=8,
        WTA_K=2,
    )


def _resize_for_features(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    scale = min(
        1.0,
        MAX_IMAGE_DIM / max(height, width),
    )

    if scale >= 1.0:
        return image

    return cv2.resize(
        image,
        (
            max(16, int(round(width * scale))),
            max(16, int(round(height * scale))),
        ),
        interpolation=cv2.INTER_AREA,
    )


def _mix_words(words: np.ndarray) -> np.ndarray:
    value = words.astype(np.uint64, copy=False)
    value ^= value >> np.uint64(16)
    value *= np.uint64(0x7FEB352D)
    value &= np.uint64(0xFFFFFFFF)
    value ^= value >> np.uint64(15)
    value *= np.uint64(0x846CA68B)
    value &= np.uint64(0xFFFFFFFF)
    value ^= value >> np.uint64(16)
    return value


def descriptors_to_words(
    descriptors: np.ndarray | None,
) -> np.ndarray:
    if descriptors is None or len(descriptors) == 0:
        return np.empty(0, dtype=np.uint16)

    descriptors = np.asarray(
        descriptors,
        dtype=np.uint8,
    )

    bits = np.unpackbits(
        descriptors,
        axis=1,
        bitorder="little",
    )

    word_parts = []

    for table in range(TABLES):
        selected = bits[:, BIT_POSITIONS[table]]
        bucket = (
            selected.astype(np.uint32)
            * BIT_WEIGHTS[None, :]
        ).sum(axis=1, dtype=np.uint32)

        words = (
            np.uint32(table * BUCKETS_PER_TABLE)
            + bucket
        ).astype(np.uint16)

        word_parts.append(words)

    words = np.unique(
        np.concatenate(word_parts)
    ).astype(np.uint16, copy=False)

    if len(words) <= WORDS_PER_IMAGE:
        return np.sort(words)

    mixed = _mix_words(words)
    keep = np.argpartition(
        mixed,
        WORDS_PER_IMAGE - 1,
    )[:WORDS_PER_IMAGE]

    return np.sort(words[keep])


def extract_words(
    image: np.ndarray,
    orb=None,
) -> np.ndarray:
    work = _resize_for_features(image)

    if work.ndim == 3:
        gray = cv2.cvtColor(
            work,
            cv2.COLOR_BGR2GRAY,
        )
    else:
        gray = work

    detector = orb if orb is not None else create_orb()
    keypoints, descriptors = detector.detectAndCompute(
        gray,
        None,
    )

    if (
        descriptors is None
        or keypoints is None
        or len(descriptors) == 0
    ):
        return np.empty(0, dtype=np.uint16)

    responses = np.asarray(
        [float(point.response) for point in keypoints],
        dtype=np.float32,
    )

    order = np.argsort(responses)[::-1][
        : min(MAX_DESCRIPTORS, len(responses))
    ]

    return descriptors_to_words(
        descriptors[order]
    )


def words_to_blob(words: np.ndarray) -> bytes:
    return np.asarray(
        words,
        dtype="<u2",
    ).tobytes()


def blob_to_words(blob: bytes | None) -> np.ndarray:
    if blob is None or len(blob) == 0:
        return np.empty(0, dtype=np.uint16)

    return np.frombuffer(
        blob,
        dtype="<u2",
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


def build_index_arrays(
    index_dir: Path,
    entries: list[tuple[int, bytes | None]],
    image_count: int,
) -> dict:
    started = time.perf_counter()
    index_dir.mkdir(parents=True, exist_ok=True)

    total_words = sum(
        len(blob or b"") // 2
        for _, blob in entries
    )

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
        words = blob_to_words(blob)
        count = len(words)

        if count == 0:
            continue

        end = cursor + count
        flat_words[cursor:end] = words
        flat_ids[cursor:end] = np.uint32(image_id)
        cursor = end

    if cursor != total_words:
        flat_words = flat_words[:cursor]
        flat_ids = flat_ids[:cursor]

    if len(flat_words):
        order = np.argsort(
            flat_words,
            kind="stable",
        )
        sorted_words = flat_words[order]
        postings = flat_ids[order]

        counts = np.bincount(
            sorted_words.astype(np.int32),
            minlength=VOCAB_SIZE,
        ).astype(np.int64)
    else:
        postings = np.empty(
            0,
            dtype=np.uint32,
        )
        counts = np.zeros(
            VOCAB_SIZE,
            dtype=np.int64,
        )

    offsets = np.zeros(
        VOCAB_SIZE + 1,
        dtype=np.int64,
    )
    offsets[1:] = np.cumsum(
        counts,
        dtype=np.int64,
    )

    idf = (
        np.log(
            (max(1, image_count) + 1.0)
            / (counts.astype(np.float64) + 1.0)
        )
        + 1.0
    ).astype(np.float32)

    stop = np.zeros(
        VOCAB_SIZE,
        dtype=np.uint8,
    )

    if image_count >= 100:
        stop[
            counts
            >= max(
                25,
                int(math.ceil(image_count * 0.15)),
            )
        ] = 1

    _save_array(
        index_dir,
        "local_postings.npy",
        postings,
    )
    _save_array(
        index_dir,
        "local_offsets.npy",
        offsets,
    )
    _save_array(
        index_dir,
        "local_idf.npy",
        idf,
    )
    _save_array(
        index_dir,
        "local_stop.npy",
        stop,
    )

    return {
        "local_postings": int(len(postings)),
        "local_postings_bytes": int(postings.nbytes),
        "local_vocab_size": int(VOCAB_SIZE),
        "local_words_per_image_cap": int(WORDS_PER_IMAGE),
        "local_stop_words": int(np.count_nonzero(stop)),
        "local_build_seconds": float(
            time.perf_counter() - started
        ),
    }


def index_available(index_dir: Path) -> bool:
    return all(
        (index_dir / filename).is_file()
        for filename in INDEX_FILENAMES
    )


def search_index(
    index_dir: Path,
    query_words: np.ndarray,
    top_k: int,
) -> tuple[np.ndarray, np.ndarray, dict]:
    started = time.perf_counter()

    if (
        not index_available(index_dir)
        or query_words is None
        or len(query_words) == 0
    ):
        return (
            np.empty(0, dtype=np.uint32),
            np.empty(0, dtype=np.float32),
            {
                "query_words": int(
                    0 if query_words is None else len(query_words)
                ),
                "usable_words": 0,
                "postings_touched": 0,
                "query_ms": float(
                    (time.perf_counter() - started) * 1000
                ),
            },
        )

    postings = np.load(
        index_dir / "local_postings.npy",
        mmap_mode="r",
    )
    offsets = np.load(
        index_dir / "local_offsets.npy",
        mmap_mode="r",
    )
    idf = np.load(
        index_dir / "local_idf.npy",
        mmap_mode="r",
    )
    stop = np.load(
        index_dir / "local_stop.npy",
        mmap_mode="r",
    )

    words = np.unique(
        np.asarray(
            query_words,
            dtype=np.uint16,
        )
    )

    words = words[
        stop[words.astype(np.int32)] == 0
    ]

    id_parts = []
    weight_parts = []
    postings_touched = 0

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
        postings_touched += len(ids)
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
            np.empty(0, dtype=np.uint32),
            np.empty(0, dtype=np.float32),
            {
                "query_words": int(len(query_words)),
                "usable_words": int(len(words)),
                "postings_touched": 0,
                "query_ms": float(
                    (time.perf_counter() - started) * 1000
                ),
            },
        )

    all_ids = np.concatenate(id_parts)
    all_weights = np.concatenate(weight_parts)

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
        order = np.argsort(scores)[::-1]
    else:
        order = np.argpartition(
            scores,
            -keep,
        )[-keep:]
        order = order[
            np.argsort(scores[order])[::-1]
        ]

    elapsed_ms = (
        time.perf_counter() - started
    ) * 1000

    return (
        unique_ids[order],
        scores[order],
        {
            "query_words": int(len(query_words)),
            "usable_words": int(len(words)),
            "postings_touched": int(postings_touched),
            "query_ms": float(elapsed_ms),
        },
    )
