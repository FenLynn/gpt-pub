from __future__ import annotations

import argparse
import time

import numpy as np


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--images",
        type=int,
        nargs="+",
        default=[100_000, 300_000, 500_000],
    )
    parser.add_argument(
        "--regions",
        type=int,
        nargs="+",
        default=[28, 60, 201],
    )
    parser.add_argument("--repeats", type=int, default=6)
    parser.add_argument("--seed", type=int, default=106)
    args = parser.parse_args()

    rng = np.random.default_rng(args.seed)

    print(
        "N,regions,raw_mib,warm_median_ms,warm_p95_ms"
    )

    for n_images in args.images:
        for region_count in args.regions:
            hashes = rng.integers(
                0,
                np.iinfo(np.uint64).max,
                size=(n_images, region_count),
                dtype=np.uint64,
            )
            query = np.uint64(
                rng.integers(
                    0,
                    np.iinfo(np.uint64).max,
                    dtype=np.uint64,
                )
            )

            timings = []
            for _ in range(args.repeats):
                t0 = time.perf_counter()
                distance = np.bitwise_count(hashes ^ query).min(axis=1)
                np.argpartition(distance, 20)[:20]
                timings.append((time.perf_counter() - t0) * 1000)

            warm = timings[1:] if len(timings) > 1 else timings
            print(
                f"{n_images},"
                f"{region_count},"
                f"{hashes.nbytes / 1024**2:.2f},"
                f"{np.median(warm):.3f},"
                f"{np.percentile(warm, 95):.3f}"
            )


if __name__ == "__main__":
    main()
