from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import cv2

import ci_acceptance_regression as fixtures
import mediaindex_core as core


def run_module(argv: list[str]) -> None:
    original = sys.argv[:]
    try:
        sys.argv = [original[0], *argv]
        core.main()
    finally:
        sys.argv = original


def main() -> None:
    with tempfile.TemporaryDirectory(
        prefix="p106-core-ci-"
    ) as temp:
        root = Path(temp)
        library = root / "library"
        queries = root / "queries"
        index_dir = root / "index"
        library.mkdir()
        queries.mkdir()

        originals = {}

        for seed in range(10):
            path = library / f"img_{seed:02d}.jpg"
            fixtures.save_jpeg(
                path,
                fixtures.rich_image(seed),
            )
            originals[seed] = path

        build_result = root / "build.json"
        run_module(
            [
                "build-index",
                "--library", str(library),
                "--index-dir", str(index_dir),
                "--output", str(build_result),
            ]
        )

        build = json.loads(
            build_result.read_text(encoding="utf-8")
        )

        if build["images"] != 10:
            raise AssertionError(build)

        if build.get("local_postings", 0) <= 0:
            raise AssertionError(build)

        for filename in (
            "local_postings.npy",
            "local_offsets.npy",
            "local_idf.npy",
            "local_stop.npy",
        ):
            if not (index_dir / filename).is_file():
                raise AssertionError(
                    f"Missing Lane B index file: {filename}"
                )

        cases = [
            (0, "recompress"),
            (1, "resize"),
            (2, "crop30"),
            (3, "asym_crop50"),
            (4, "watermark"),
        ]

        results = []

        for number, (seed, kind) in enumerate(cases):
            query = queries / f"q_{number:02d}_{kind}.jpg"
            fixtures.save_jpeg(
                query,
                fixtures.transform(
                    fixtures.rich_image(seed),
                    kind,
                ),
                quality=80,
            )

            output = root / f"query_{number:02d}.json"
            run_module(
                [
                    "query-image",
                    "--index-dir", str(index_dir),
                    "--query", str(query),
                    "--output", str(output),
                    "--topk", "10",
                    "--verify-k", "8",
                ]
            )

            data = json.loads(
                output.read_text(encoding="utf-8")
            )

            if not data["results"]:
                raise AssertionError(data)

            top = data["results"][0]

            if top["relpath"] != originals[seed].name:
                raise AssertionError(
                    {
                        "expected": originals[seed].name,
                        "actual": top,
                        "all": data,
                    }
                )

            results.append(
                {
                    "query": query.name,
                    "source": top["relpath"],
                    "confidence": top["confidence"],
                    "ranking_mode": data["ranking_mode"],
                    "candidate_ms": data["candidate_ms"],
                    "total_ms": data["total_ms"],
                }
            )

        # Rebuild without changes. This exercises incremental reuse.
        rebuild_result = root / "rebuild.json"
        run_module(
            [
                "build-index",
                "--library", str(library),
                "--index-dir", str(index_dir),
                "--output", str(rebuild_result),
            ]
        )
        rebuild = json.loads(
            rebuild_result.read_text(encoding="utf-8")
        )

        if rebuild["reused"] != 10:
            raise AssertionError(rebuild)

        # Mutate a tiny subset. Lane B must use a delta overlay,
        # not rebuild the immutable base.
        updated_image = fixtures.transform(
            fixtures.rich_image(2),
            "watermark",
        )
        fixtures.save_jpeg(
            originals[2],
            updated_image,
            quality=84,
        )

        new_source = library / "img_10.jpg"
        fixtures.save_jpeg(
            new_source,
            fixtures.rich_image(10),
        )

        deleted_source = originals[3]
        deleted_source.unlink()

        delta_result = root / "delta-build.json"
        run_module(
            [
                "build-index",
                "--library", str(library),
                "--index-dir", str(index_dir),
                "--output", str(delta_result),
            ]
        )
        delta_build = json.loads(
            delta_result.read_text(
                encoding="utf-8"
            )
        )

        if delta_build.get(
            "local_index_mode"
        ) != "delta":
            raise AssertionError(
                delta_build
            )

        if delta_build.get(
            "local_delta_override_count",
            0,
        ) < 3:
            raise AssertionError(
                delta_build
            )

        if not (
            index_dir
            / "local_override_ids.npy"
        ).is_file():
            raise AssertionError(
                "delta override mask missing"
            )

        delta_cases = [
            (
                "updated",
                originals[2],
                fixtures.transform(
                    updated_image,
                    "crop30",
                ),
            ),
            (
                "new",
                new_source,
                fixtures.transform(
                    fixtures.rich_image(10),
                    "resize",
                ),
            ),
        ]

        delta_queries = []

        for label, source, query_image in delta_cases:
            query = queries / f"delta_{label}.jpg"
            fixtures.save_jpeg(
                query,
                query_image,
                quality=80,
            )
            output = root / f"delta_{label}.json"

            run_module(
                [
                    "query-image",
                    "--index-dir", str(index_dir),
                    "--query", str(query),
                    "--output", str(output),
                    "--topk", "10",
                    "--verify-k", "8",
                ]
            )

            data = json.loads(
                output.read_text(
                    encoding="utf-8"
                )
            )

            if (
                not data["results"]
                or data["results"][0]["relpath"]
                != source.name
            ):
                raise AssertionError(
                    {
                        "label": label,
                        "expected": source.name,
                        "result": data,
                    }
                )

            if not data.get(
                "lane_b_overlay",
                False,
            ):
                raise AssertionError(
                    data
                )

            delta_queries.append(
                {
                    "label": label,
                    "top": data["results"][0],
                    "override_count": data.get(
                        "lane_b_override_count"
                    ),
                }
            )

        deleted_query = queries / "deleted_old.jpg"
        fixtures.save_jpeg(
            deleted_query,
            fixtures.rich_image(3),
            quality=90,
        )
        deleted_output = root / "deleted.json"

        run_module(
            [
                "query-image",
                "--index-dir", str(index_dir),
                "--query", str(deleted_query),
                "--output", str(deleted_output),
                "--topk", "10",
                "--verify-k", "8",
            ]
        )

        deleted_result = json.loads(
            deleted_output.read_text(
                encoding="utf-8"
            )
        )

        if any(
            item["relpath"]
            == "img_03.jpg"
            for item
            in deleted_result["results"]
        ):
            raise AssertionError(
                {
                    "reason": (
                        "deleted image leaked from "
                        "immutable Lane B base"
                    ),
                    "result": deleted_result,
                }
            )

        # A subsequent no-change build must keep the existing
        # base+delta overlay instead of rebuilding it.
        overlay_reuse_output = (
            root / "overlay-reuse.json"
        )
        run_module(
            [
                "build-index",
                "--library", str(library),
                "--index-dir", str(index_dir),
                "--output", str(
                    overlay_reuse_output
                ),
            ]
        )
        overlay_reuse = json.loads(
            overlay_reuse_output.read_text(
                encoding="utf-8"
            )
        )

        if overlay_reuse.get(
            "local_index_mode"
        ) != "reuse":
            raise AssertionError(
                overlay_reuse
            )

        if overlay_reuse.get(
            "local_delta_override_count",
            0,
        ) < 3:
            raise AssertionError(
                overlay_reuse
            )

        # Exact byte-identical query.
        exact_query = queries / "exact.jpg"
        exact_query.write_bytes(
            originals[5].read_bytes()
        )
        exact_output = root / "exact.json"
        run_module(
            [
                "query-image",
                "--index-dir", str(index_dir),
                "--query", str(exact_query),
                "--output", str(exact_output),
                "--topk", "10",
                "--verify-k", "8",
            ]
        )
        exact = json.loads(
            exact_output.read_text(encoding="utf-8")
        )

        if (
            not exact["results"]
            or exact["results"][0]["confidence"] != "Exact"
            or exact["results"][0]["relpath"]
            != originals[5].name
        ):
            raise AssertionError(exact)

        print(
            json.dumps(
                {
                    "ok": True,
                    "index_build": build,
                    "incremental_rebuild": rebuild,
                    "delta_build": delta_build,
                    "delta_queries": delta_queries,
                    "overlay_reuse": overlay_reuse,
                    "queries": results,
                    "exact": exact["results"][0],
                },
                ensure_ascii=False,
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
