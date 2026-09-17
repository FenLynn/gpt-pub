from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
from pathlib import Path

import ci_acceptance_regression as fixtures
import storage_lifecycle as lifecycle


STORAGE_ID = "CI-VOLUME-001"


def run_module(argv: list[str]) -> None:
    original = sys.argv[:]
    try:
        sys.argv = [original[0], *argv]
        lifecycle.main()
    finally:
        sys.argv = original


def meta(index_dir: Path) -> dict[str, str]:
    connection = sqlite3.connect(
        index_dir / "index.sqlite3"
    )
    try:
        return {
            str(key): str(value)
            for key, value in connection.execute(
                "SELECT key,value FROM meta"
            )
        }
    finally:
        connection.close()


def build(
    library: Path,
    storage_root: Path,
    index_dir: Path,
    output: Path,
) -> dict:
    run_module(
        [
            "build-index",
            "--library", str(library),
            "--index-dir", str(index_dir),
            "--output", str(output),
            "--storage-id", STORAGE_ID,
            "--storage-root", str(storage_root),
            "--library-relative", "Library",
        ]
    )
    return json.loads(
        output.read_text(encoding="utf-8")
    )


def query(
    index_dir: Path,
    query_path: Path,
    output: Path,
) -> dict:
    run_module(
        [
            "query-image",
            "--index-dir", str(index_dir),
            "--query", str(query_path),
            "--output", str(output),
            "--topk", "10",
            "--verify-k", "6",
        ]
    )
    return json.loads(
        output.read_text(encoding="utf-8")
    )


def main() -> None:
    with tempfile.TemporaryDirectory(
        prefix="p106-storage-ci-"
    ) as temp:
        root = Path(temp)
        mount_a = root / "mount-a"
        library_a = mount_a / "Library"
        queries = root / "queries"
        library_a.mkdir(parents=True)
        queries.mkdir()

        for seed in range(4):
            fixtures.save_jpeg(
                library_a / f"img_{seed:02d}.jpg",
                fixtures.rich_image(seed),
            )

        index_id = lifecycle.stable_index_id(
            STORAGE_ID,
            "Library",
        )
        index_dir = root / "Indexes" / index_id

        initial = build(
            library_a,
            mount_a,
            index_dir,
            root / "initial.json",
        )

        if initial["images"] != 4:
            raise AssertionError(initial)

        if initial.get("storage_rebound"):
            raise AssertionError(initial)

        initial_generation = initial.get(
            "active_generation",
            "",
        )
        if not initial_generation:
            raise AssertionError(initial)

        stored = meta(index_dir)
        if (
            stored.get("storage_id") != STORAGE_ID
            or stored.get("library_relative") != "Library"
        ):
            raise AssertionError(stored)

        query_path = queries / "query.jpg"
        fixtures.save_jpeg(
            query_path,
            fixtures.transform(
                fixtures.rich_image(1),
                "resize",
            ),
            quality=82,
        )

        mount_b = root / "mount-b"
        mount_a.rename(mount_b)
        library_b = mount_b / "Library"

        rebound = build(
            library_b,
            mount_b,
            index_dir,
            root / "rebound.json",
        )

        if not rebound.get("storage_rebound"):
            raise AssertionError(rebound)

        if (
            rebound["added"] != 0
            or rebound["updated"] != 0
            or rebound["removed"] != 0
            or rebound["reused"] != 4
        ):
            raise AssertionError(rebound)

        if (
            rebound.get("active_generation")
            != initial_generation
        ):
            raise AssertionError(
                {
                    "reason": (
                        "mount change unexpectedly rebuilt "
                        "the immutable generation"
                    ),
                    "initial": initial,
                    "rebound": rebound,
                }
            )

        online = query(
            index_dir,
            query_path,
            root / "online-query.json",
        )
        if (
            not online["results"]
            or online["results"][0]["relpath"]
            != "img_01.jpg"
            or not online["results"][0]["online"]
            or not online.get("storage_online")
        ):
            raise AssertionError(online)

        detached = root / "detached"
        mount_b.rename(detached)

        offline = query(
            index_dir,
            query_path,
            root / "offline-query.json",
        )
        if (
            not offline["results"]
            or offline["results"][0]["relpath"]
            != "img_01.jpg"
            or offline["results"][0]["online"]
            or offline.get("storage_online")
        ):
            raise AssertionError(offline)

        mount_c = root / "mount-c"
        detached.rename(mount_c)
        library_c = mount_c / "Library"

        reattached = build(
            library_c,
            mount_c,
            index_dir,
            root / "reattached.json",
        )

        if (
            not reattached.get("storage_rebound")
            or reattached["reused"] != 4
            or reattached.get("active_generation")
            != initial_generation
        ):
            raise AssertionError(reattached)

        wrong_id_failed = False
        try:
            run_module(
                [
                    "build-index",
                    "--library", str(library_c),
                    "--index-dir", str(index_dir),
                    "--output", str(
                        root / "wrong-id.json"
                    ),
                    "--storage-id", "CI-VOLUME-OTHER",
                    "--storage-root", str(mount_c),
                    "--library-relative", "Library",
                ]
            )
        except SystemExit:
            wrong_id_failed = True

        if not wrong_id_failed:
            raise AssertionError(
                "wrong storage identity was accepted"
            )

        final_meta = meta(index_dir)
        if final_meta.get("storage_id") != STORAGE_ID:
            raise AssertionError(final_meta)

        print(
            json.dumps(
                {
                    "ok": True,
                    "index_id": index_id,
                    "initial_generation": initial_generation,
                    "rebound_reused": rebound["reused"],
                    "offline_top": offline["results"][0][
                        "relpath"
                    ],
                    "reattached_reused": reattached[
                        "reused"
                    ],
                    "identity_guard": wrong_id_failed,
                },
                ensure_ascii=False,
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
