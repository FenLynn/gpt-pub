from __future__ import annotations

import gc
import json

import numpy as np

import r017_persistent_lane_b_scale as r017
import r018_lane_b_delta_overlay as r018


def run_r017() -> dict:
    results = []

    for n_images in (
        10_000,
        100_000,
        500_000,
    ):
        index, stats = r017.build_index(
            n_images,
            106,
        )

        memory = r017.benchmark_memory(
            index,
            n_images,
            query_count=40,
            seed=107,
        )

        item = {
            "stats": stats,
            "memory_query": memory,
        }

        if n_images == 500_000:
            mmap_result = r017.benchmark_mmap(
                index,
                n_images,
                query_count=80,
                seed=108,
            )
            item["mmap_query"] = mmap_result

            if stats["postings_mib"] > 135.0:
                raise AssertionError(
                    {
                        "reason": "500k postings too large",
                        "stats": stats,
                    }
                )

            if (
                memory["shared_unique_1"]["top20"]
                != memory["shared_unique_1"]["queries"]
            ):
                raise AssertionError(
                    {
                        "reason": (
                            "500k Lane B Top20 recall "
                            "regressed"
                        ),
                        "memory": memory,
                    }
                )

            if (
                mmap_result["top20"]
                != mmap_result["queries"]
            ):
                raise AssertionError(
                    {
                        "reason": (
                            "500k mmap Top20 recall "
                            "regressed"
                        ),
                        "mmap": mmap_result,
                    }
                )

            if mmap_result["p95_query_ms"] > 25.0:
                raise AssertionError(
                    {
                        "reason": (
                            "500k mmap P95 query "
                            "latency regressed"
                        ),
                        "mmap": mmap_result,
                    }
                )

        results.append(item)

        del index
        gc.collect()

    return {
        "runs": results,
    }


def run_r018() -> dict:
    base_size = 500_000
    ids = np.arange(
        base_size,
        dtype=np.uint32,
    )

    (
        words,
        cluster,
        unique,
    ) = r018.make_words(
        ids,
        106,
    )

    base = r018.build_index(
        words,
        ids,
        base_size,
    )

    baseline = r018.benchmark_base(
        base,
        cluster,
        unique,
        query_count=80,
        seed=107,
    )

    overlays = []

    for fraction in (
        0.001,
        0.01,
        0.05,
    ):
        result = r018.benchmark_overlay(
            base_index=base,
            base_cluster=cluster,
            base_unique=unique,
            base_size=base_size,
            fraction=fraction,
            query_count=80,
            seed=116,
        )

        each = int(
            result["queries_each_class"]
        )

        for kind in (
            "unchanged",
            "updated",
            "new",
        ):
            if result["top20"][kind] != each:
                raise AssertionError(
                    {
                        "reason": (
                            "delta overlay Top20 "
                            f"regressed for {kind}"
                        ),
                        "result": result,
                    }
                )

        if result["deleted_absent"] != each:
            raise AssertionError(
                {
                    "reason": (
                        "deleted IDs leaked from "
                        "base generation"
                    ),
                    "result": result,
                }
            )

        if fraction == 0.05:
            if result[
                "delta_postings_mib"
            ] > 7.0:
                raise AssertionError(
                    {
                        "reason": (
                            "5% delta postings "
                            "too large"
                        ),
                        "result": result,
                    }
                )

            if result["p95_ms"] > 15.0:
                raise AssertionError(
                    {
                        "reason": (
                            "5% delta query P95 "
                            "regressed"
                        ),
                        "result": result,
                    }
                )

        overlays.append(result)

    return {
        "base": baseline,
        "overlays": overlays,
    }


def main() -> None:
    scale = run_r017()
    overlay = run_r018()

    print(
        json.dumps(
            {
                "ok": True,
                "r017": scale,
                "r018": overlay,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
