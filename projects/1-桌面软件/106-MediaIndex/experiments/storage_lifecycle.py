from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
import time
from pathlib import Path

import mediaindex_core as core


BINDING_VERSION = "1"


def canonical_storage_id(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("storage_id is empty")
    return value.upper()


def canonical_relative(value: str) -> str:
    value = value.replace("\\", "/").strip("/")
    if not value or value == ".":
        return "."
    return value


def stable_index_id(storage_id: str, library_relative: str) -> str:
    key = (
        canonical_storage_id(storage_id)
        + "\n"
        + canonical_relative(library_relative).upper()
    )
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def path_key(value: str | Path) -> str:
    return str(Path(value).resolve()).casefold()


def _read_meta(index_dir: Path) -> dict[str, str]:
    database = index_dir / "index.sqlite3"
    if not database.is_file():
        return {}

    connection = sqlite3.connect(database)
    try:
        return {
            str(key): str(value)
            for key, value in connection.execute(
                "SELECT key,value FROM meta"
            )
        }
    finally:
        connection.close()


def _write_meta(index_dir: Path, values: dict[str, str]) -> None:
    connection = core.db_connect(index_dir)
    try:
        for key, value in values.items():
            core.set_meta(connection, key, str(value))
        connection.commit()
    finally:
        connection.close()


def _binding_values(
    *,
    library: Path,
    storage_id: str,
    storage_root: Path,
    library_relative: str,
) -> dict[str, str]:
    return {
        "storage_binding_version": BINDING_VERSION,
        "storage_id": canonical_storage_id(storage_id),
        "storage_root": str(storage_root.resolve()),
        "library_relative": canonical_relative(library_relative),
        "storage_last_seen_unix": str(time.time()),
        "storage_online": "1",
        "library_root": str(library.resolve()),
    }


def prepare_binding(
    *,
    library: Path,
    index_dir: Path,
    storage_id: str,
    storage_root: Path,
    library_relative: str,
) -> bool:
    meta = _read_meta(index_dir)
    if not meta:
        return False

    wanted_id = canonical_storage_id(storage_id)
    wanted_relative = canonical_relative(library_relative)
    existing_id = meta.get("storage_id", "").strip().upper()
    existing_relative = canonical_relative(
        meta.get("library_relative", ".")
    )

    if existing_id and existing_id != wanted_id:
        raise SystemExit(
            "Index storage identity mismatch. "
            f"Existing: {meta.get('storage_id', '')}"
        )

    if (
        existing_id
        and existing_relative.upper() != wanted_relative.upper()
    ):
        raise SystemExit(
            "Index library-relative path mismatch. "
            f"Existing: {meta.get('library_relative', '')}"
        )

    old_library = meta.get("library_root", "").strip()
    rebound = bool(
        old_library
        and path_key(old_library) != path_key(library)
    )

    if not existing_id and rebound:
        raise SystemExit(
            "Legacy path-bound index cannot be rebound before "
            "a storage identity has been adopted at its original path."
        )

    if existing_id and rebound:
        _write_meta(
            index_dir,
            _binding_values(
                library=library,
                storage_id=storage_id,
                storage_root=storage_root,
                library_relative=library_relative,
            ),
        )

    return rebound


def finalize_binding(
    *,
    library: Path,
    index_dir: Path,
    storage_id: str,
    storage_root: Path,
    library_relative: str,
) -> None:
    _write_meta(
        index_dir,
        _binding_values(
            library=library,
            storage_id=storage_id,
            storage_root=storage_root,
            library_relative=library_relative,
        ),
    )


def _rewrite_output(
    output: Path,
    *,
    index_dir: Path,
    extra: dict | None = None,
) -> None:
    if not output.is_file():
        return

    payload = json.loads(
        output.read_text(encoding="utf-8")
    )
    meta = _read_meta(index_dir)
    library_root = meta.get("library_root", "")
    payload.update(
        {
            "storage_binding_version": meta.get(
                "storage_binding_version",
                "",
            ),
            "storage_id": meta.get("storage_id", ""),
            "storage_root": meta.get("storage_root", ""),
            "library_relative": meta.get(
                "library_relative",
                "",
            ),
            "storage_online": bool(
                library_root
                and Path(library_root).is_dir()
            ),
        }
    )

    if extra:
        payload.update(extra)

    core.json_write(output, payload)


def build_index_with_binding(args: argparse.Namespace) -> None:
    library = Path(args.library).resolve()
    index_dir = Path(args.index_dir)
    output = Path(args.output)

    supplied = [
        args.storage_id,
        args.storage_root,
        args.library_relative,
    ]

    if any(value is not None for value in supplied) and not all(
        value is not None for value in supplied
    ):
        raise SystemExit(
            "--storage-id, --storage-root and --library-relative "
            "must be supplied together"
        )

    if not all(value is not None for value in supplied):
        core.build_index(library, index_dir, output)
        return

    storage_id = str(args.storage_id)
    storage_root = Path(str(args.storage_root)).resolve()
    library_relative = canonical_relative(
        str(args.library_relative)
    )

    expected_id = stable_index_id(
        storage_id,
        library_relative,
    )

    if index_dir.name.casefold() != expected_id.casefold():
        raise SystemExit(
            "Index directory does not match stable storage binding. "
            f"Expected index id: {expected_id}"
        )

    rebound = prepare_binding(
        library=library,
        index_dir=index_dir,
        storage_id=storage_id,
        storage_root=storage_root,
        library_relative=library_relative,
    )

    core.build_index(library, index_dir, output)

    finalize_binding(
        library=library,
        index_dir=index_dir,
        storage_id=storage_id,
        storage_root=storage_root,
        library_relative=library_relative,
    )

    _rewrite_output(
        output,
        index_dir=index_dir,
        extra={
            "index_id": expected_id,
            "storage_rebound": rebound,
        },
    )


def delegate_and_augment(command: str, arguments: list[str]) -> None:
    original = sys.argv[:]
    try:
        sys.argv = [original[0], command, *arguments]
        core.main()
    finally:
        sys.argv = original

    try:
        index_pos = arguments.index("--index-dir") + 1
        output_pos = arguments.index("--output") + 1
        index_dir = Path(arguments[index_pos])
        output = Path(arguments[output_pos])
    except (ValueError, IndexError):
        return

    _rewrite_output(
        output,
        index_dir=index_dir,
    )


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(
            "Usage: storage_lifecycle.py "
            "{build-index|query-image|index-info} ..."
        )

    command = sys.argv[1].strip().lower()
    arguments = sys.argv[2:]

    if command == "build-index":
        parser = argparse.ArgumentParser(
            description=(
                "MediaIndex persistent build with stable "
                "storage identity"
            )
        )
        parser.add_argument("--library", required=True)
        parser.add_argument("--index-dir", required=True)
        parser.add_argument("--output", required=True)
        parser.add_argument("--storage-id")
        parser.add_argument("--storage-root")
        parser.add_argument("--library-relative")
        args = parser.parse_args(arguments)
        build_index_with_binding(args)
        return

    if command in {"query-image", "index-info"}:
        delegate_and_augment(command, arguments)
        return

    raise SystemExit(f"Unknown storage lifecycle command: {command}")


if __name__ == "__main__":
    main()
