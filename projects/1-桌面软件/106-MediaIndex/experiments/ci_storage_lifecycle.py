from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
from pathlib import Path

import ci_acceptance_regression as fixtures
import storage_lifecycle as lifecycle


STORAGE_ID = "CI-VOLUME-001"
LEGACY_STORAGE_ID = "CI-VOLUME-LEGACY"


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


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            payload,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def build(
    library: Path,
    storage_root: Path,
    index_dir: Path,
    output: Path,
    *,
    storage_id: str = STORAGE_ID,
    library_relative: str = "Library",
) -> dict:
    run_module(
        [
            "build-index",
            "--library", str(library),
            "--index-dir", str(index_dir),
            "--output", str(output),
            "--storage-id", storage_id,
            "--storage-root", str(storage_root),
            "--library-relative", library_relative,
        ]
    )
    return json.loads(
        output.read_text(encoding="utf-8")
    )


def legacy_build(
    library: Path,
    index_dir: Path,
    output: Path,
) -> dict:
    run_module(
        [
            "build-index",
            "--library", str(library),
            "--index-dir", str(index_dir),
            "--output", str(output),
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


def write_location_marker(
    index_dir: Path,
    *,
    storage_id: str,
    storage_root: Path,
    library_relative: str,
    library_root: Path,
) -> None:
    write_json(
        index_dir / lifecycle.LOCATION_MARKER_NAME,
        {
            "version": 1,
            "index_id": lifecycle.stable_index_id(
                storage_id,
                library_relative,
            ),
            "storage_id": storage_id,
            "storage_root": str(storage_root),
            "library_relative": library_relative,
            "library_root": str(library_root),
        },
    )


def write_rebind_marker(
    index_dir: Path,
    *,
    storage_id: str,
    library_relative: str,
    previous_library_root: Path,
    library_root: Path,
) -> None:
    write_json(
        index_dir / lifecycle.REBIND_MARKER_NAME,
        {
            "version": 1,
            "index_id": lifecycle.stable_index_id(
                storage_id,
                library_relative,
            ),
            "storage_id": storage_id,
            "library_relative": library_relative,
            "previous_library_root": str(
                previous_library_root
            ),
            "library_root": str(library_root),
        },
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

        write_location_marker(
            index_dir,
            storage_id=STORAGE_ID,
            storage_root=mount_c,
            library_relative="Library",
            library_root=library_c,
        )

        auto_reattached = query(
            index_dir,
            query_path,
            root / "auto-reattached-query.json",
        )
        if (
            not auto_reattached.get(
                "storage_reattached"
            )
            or not auto_reattached.get(
                "storage_online"
            )
            or not auto_reattached["results"]
            or not auto_reattached["results"][0][
                "online"
            ]
            or auto_reattached["results"][0][
                "relpath"
            ] != "img_01.jpg"
        ):
            raise AssertionError(auto_reattached)

        reattached = build(
            library_c,
            mount_c,
            index_dir,
            root / "reattached.json",
        )

        if (
            reattached.get("storage_rebound")
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

        # Legacy v0.4 style index. It has library_root but no storage_id.
        legacy_mount_a = root / "legacy-a"
        legacy_library_a = legacy_mount_a / "LegacyLibrary"
        legacy_library_a.mkdir(parents=True)

        for seed in range(2):
            fixtures.save_jpeg(
                legacy_library_a / f"legacy_{seed:02d}.jpg",
                fixtures.rich_image(seed + 20),
            )

        legacy_old_index = root / "legacy-path-index"
        legacy_initial = legacy_build(
            legacy_library_a,
            legacy_old_index,
            root / "legacy-initial.json",
        )
        if legacy_initial["images"] != 2:
            raise AssertionError(legacy_initial)

        legacy_mount_b = root / "legacy-b"
        legacy_mount_a.rename(legacy_mount_b)
        legacy_library_b = (
            legacy_mount_b / "LegacyLibrary"
        )

        legacy_stable_id = lifecycle.stable_index_id(
            LEGACY_STORAGE_ID,
            "LegacyLibrary",
        )
        legacy_stable_index = (
            root / "Indexes" / legacy_stable_id
        )
        legacy_stable_index.parent.mkdir(
            parents=True,
            exist_ok=True,
        )
        legacy_old_index.rename(
            legacy_stable_index
        )

        write_rebind_marker(
            legacy_stable_index,
            storage_id=LEGACY_STORAGE_ID,
            library_relative="LegacyLibrary",
            previous_library_root=legacy_library_a,
            library_root=legacy_library_b,
        )
        write_location_marker(
            legacy_stable_index,
            storage_id=LEGACY_STORAGE_ID,
            storage_root=legacy_mount_b,
            library_relative="LegacyLibrary",
            library_root=legacy_library_b,
        )

        legacy_query = queries / "legacy-query.jpg"
        fixtures.save_jpeg(
            legacy_query,
            fixtures.transform(
                fixtures.rich_image(20),
                "resize",
            ),
            quality=82,
        )

        legacy_first_query = query(
            legacy_stable_index,
            legacy_query,
            root / "legacy-first-query.json",
        )

        if (
            not legacy_first_query.get(
                "storage_reattached"
            )
            or not legacy_first_query.get(
                "storage_online"
            )
            or not legacy_first_query["results"]
            or not legacy_first_query["results"][0][
                "online"
            ]
            or legacy_first_query["results"][0][
                "relpath"
            ] != "legacy_00.jpg"
            or (
                legacy_stable_index
                / lifecycle.REBIND_MARKER_NAME
            ).exists()
        ):
            raise AssertionError(legacy_first_query)

        legacy_rebound = build(
            legacy_library_b,
            legacy_mount_b,
            legacy_stable_index,
            root / "legacy-rebound.json",
            storage_id=LEGACY_STORAGE_ID,
            library_relative="LegacyLibrary",
        )

        if (
            legacy_rebound.get(
                "storage_rebound"
            )
            or legacy_rebound["reused"] != 2
            or (
                legacy_stable_index
                / lifecycle.REBIND_MARKER_NAME
            ).exists()
        ):
            raise AssertionError(legacy_rebound)

        legacy_meta = meta(
            legacy_stable_index
        )
        if (
            legacy_meta.get("storage_id")
            != LEGACY_STORAGE_ID
            or legacy_meta.get("library_relative")
            != "LegacyLibrary"
            or lifecycle.path_key(
                legacy_meta.get("library_root", "")
            )
            != lifecycle.path_key(
                legacy_library_b
            )
        ):
            raise AssertionError(legacy_meta)

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
                    "auto_reattached": bool(
                        auto_reattached.get(
                            "storage_reattached"
                        )
                    ),
                    "reattached_reused": reattached[
                        "reused"
                    ],
                    "identity_guard": wrong_id_failed,
                    "legacy_first_query_reattached": bool(
                        legacy_first_query.get(
                            "storage_reattached"
                        )
                    ),
                    "legacy_rebind_reused": (
                        legacy_rebound["reused"]
                    ),
                },
                ensure_ascii=False,
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
