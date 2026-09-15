from __future__ import annotations

import argparse
import math
import time
from dataclasses import dataclass

import numpy as np


@dataclass
class Index:
    postings: np.ndarray
    offsets: np.ndarray
    idf: np.ndarray
    stop: np.ndarray
    words_by_image: np.ndarray


def build_index(
    n_images: int,
    words_per_image: int,
    vocab_size: int,
    common_vocab: int,
    common_probability: float,
    seed: int,
) -> tuple[Index, dict]:
    rng = np.random.default_rng(seed)

    t0 = time.perf_counter()
    common_mask = rng.random((n_images, words_per_image)) < common_probability
    words = rng.integers(
        common_vocab,
        vocab_size,
        size=(n_images, words_per_image),
        dtype=np.int32,
    )
    words[common_mask] = rng.integers(
        0,
        common_vocab,
        size=int(common_mask.sum()),
        dtype=np.int32,
    )

    words.sort(axis=1)
    keep = np.ones_like(words, dtype=bool)
    keep[:, 1:] = words[:, 1:] != words[:, :-1]

    flat_words = words[keep]
    image_ids = np.repeat(
        np.arange(n_images, dtype=np.int32),
        keep.sum(axis=1),
    )

    order = np.argsort(flat_words, kind="stable")
    sorted_words = flat_words[order]
    postings = image_ids[order]

    counts = np.bincount(sorted_words, minlength=vocab_size).astype(np.int32)
    offsets = np.zeros(vocab_size + 1, dtype=np.int64)
    offsets[1:] = np.cumsum(counts, dtype=np.int64)
    idf = np.log((n_images + 1) / (counts + 1)).astype(np.float32)

    stop_count = max(1, int(round(vocab_size * 0.01)))
    stop_ids = np.argpartition(counts, -stop_count)[-stop_count:]
    stop = np.zeros(vocab_size, dtype=bool)
    stop[stop_ids] = True

    build_seconds = time.perf_counter() - t0

    stats = {
        "build_seconds": build_seconds,
        "mean_unique_words_per_image": float(keep.sum(axis=1).mean()),
        "posting_count": int(postings.size),
        "posting_mib": postings.nbytes / 1024**2,
        "offset_mib": offsets.nbytes / 1024**2,
        "idf_mib": idf.nbytes / 1024**2,
        "word_matrix_mib": words.nbytes / 1024**2,
    }
    return Index(postings, offsets, idf, stop, words), stats


def search_sparse(index: Index, qwords: np.ndarray, topk: int) -> tuple[np.ndarray, int]:
    q = np.unique(np.asarray(qwords, dtype=np.int32))
    q = q[~index.stop[q]]

    id_parts = []
    weight_parts = []
    for word in q:
        a = int(index.offsets[word])
        b = int(index.offsets[word + 1])
        if b <= a:
            continue
        ids = index.postings[a:b]
        id_parts.append(ids)
        weight_parts.append(
            np.full(ids.size, index.idf[word], dtype=np.float32)
        )

    if not id_parts:
        return np.empty(0, dtype=np.int32), 0

    ids = np.concatenate(id_parts)
    weights = np.concatenate(weight_parts)
    unique_ids, inverse = np.unique(ids, return_inverse=True)
    scores = np.bincount(inverse, weights=weights).astype(np.float32)

    k = min(topk, unique_ids.size)
    if k == 0:
        return np.empty(0, dtype=np.int32), ids.size

    if k == unique_ids.size:
        order = np.argsort(scores)[::-1]
    else:
        order = np.argpartition(scores, -k)[-k:]
        order = order[np.argsort(scores[order])[::-1]]

    return unique_ids[order], ids.size


def benchmark(index: Index, n_images: int, vocab_size: int, seed: int) -> None:
    rng = np.random.default_rng(seed)
    targets = rng.choice(n_images, size=min(100, n_images), replace=False)

    frequencies = np.diff(index.offsets)
    common_words = np.argsort(frequencies)[-50:]

    for shared_count in (1, 2, 4):
        hit5 = 0
        hit20 = 0
        hit50 = 0
        timings = []
        postings = []

        for target in targets:
            target_words = np.unique(index.words_by_image[target])
            usable = target_words[~index.stop[target_words]]
            if usable.size == 0:
                continue

            take = min(shared_count, usable.size)
            shared = rng.choice(usable, size=take, replace=False)
            common = rng.choice(common_words, size=4, replace=False)
            noise = rng.integers(0, vocab_size, size=8, dtype=np.int32)
            query = np.concatenate([shared, common, noise])

            t0 = time.perf_counter()
            ranked, posting_count = search_sparse(index, query, topk=50)
            timings.append((time.perf_counter() - t0) * 1000)
            postings.append(posting_count)

            hit5 += int(target in ranked[:5])
            hit20 += int(target in ranked[:20])
            hit50 += int(target in ranked[:50])

        print()
        print(f"shared_nonstop_words={shared_count}")
        print(f"Top5  {hit5}/{len(targets)}")
        print(f"Top20 {hit20}/{len(targets)}")
        print(f"Top50 {hit50}/{len(targets)}")
        print(f"median_query_ms={np.median(timings):.3f}")
        print(f"p95_query_ms={np.percentile(timings, 95):.3f}")
        print(f"median_postings_touched={np.median(postings):.0f}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--images", type=int, default=500_000)
    parser.add_argument("--words-per-image", type=int, default=48)
    parser.add_argument("--vocab-size", type=int, default=65_536)
    parser.add_argument("--common-vocab", type=int, default=512)
    parser.add_argument("--common-probability", type=float, default=0.20)
    parser.add_argument("--seed", type=int, default=106)
    args = parser.parse_args()

    index, stats = build_index(
        n_images=args.images,
        words_per_image=args.words_per_image,
        vocab_size=args.vocab_size,
        common_vocab=args.common_vocab,
        common_probability=args.common_probability,
        seed=args.seed,
    )

    print("Synthetic visual word inverted index")
    print(f"images={args.images}")
    print(f"words_per_image={args.words_per_image}")
    for key, value in stats.items():
        print(f"{key}={value}")

    benchmark(index, args.images, args.vocab_size, args.seed + 1)


if __name__ == "__main__":
    main()
