"""Regression checks for the production generation protocol.

The active pointer lives in SQLite metadata and is committed atomically with
the image metadata changes. Generation payloads are immutable and validated
before that transaction can commit.
"""

from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path

import index_generation


def create_meta_db(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.execute(
        """
        CREATE TABLE meta(
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    connection.commit()
    return connection


def set_active(
    connection: sqlite3.Connection,
    generation: str,
) -> None:
    connection.execute(
        """
        INSERT INTO meta(key,value)
        VALUES('active_generation', ?)
        ON CONFLICT(key)
        DO UPDATE SET value=excluded.value
        """,
        (generation,),
    )


def active(
    connection: sqlite3.Connection,
) -> str:
    row = connection.execute(
        """
        SELECT value
        FROM meta
        WHERE key='active_generation'
        """
    ).fetchone()
    return "" if row is None else str(row[0])


def write_required(
    generation: Path,
    *,
    omit: str | None = None,
) -> None:
    for filename in index_generation.BASE_FILES:
        if filename == omit:
            continue
        (
            generation / filename
        ).write_bytes(
            ("payload:" + filename).encode("utf-8")
        )


def main() -> None:
    with tempfile.TemporaryDirectory(
        prefix="p106-generation-ci-"
    ) as temp:
        index_dir = Path(temp) / "index"
        index_dir.mkdir()

        connection = create_meta_db(
            index_dir / "index.sqlite3"
        )

        try:
            first = index_generation.create_generation(
                index_dir
            )
            write_required(first)
            index_generation.write_manifest(
                first,
                mode="base",
                files=index_generation.BASE_FILES,
                previous_generation=None,
            )
            set_active(
                connection,
                first.name,
            )
            connection.commit()

            meta = {
                "active_generation": active(
                    connection
                )
            }
            if (
                index_generation.resolve_active(
                    index_dir,
                    meta,
                )
                != first
            ):
                raise AssertionError(
                    "initial generation not active"
                )

            partial = (
                index_generation.create_generation(
                    index_dir
                )
            )
            write_required(
                partial,
                omit="local_stop.npy",
            )

            try:
                index_generation.write_manifest(
                    partial,
                    mode="delta",
                    files=index_generation.BASE_FILES,
                    previous_generation=first.name,
                )
            except RuntimeError:
                pass
            else:
                raise AssertionError(
                    "partial generation became valid"
                )

            if active(connection) != first.name:
                raise AssertionError(
                    "failed build changed active pointer"
                )

            second = (
                index_generation.create_generation(
                    index_dir
                )
            )
            write_required(second)
            index_generation.write_manifest(
                second,
                mode="compact",
                files=index_generation.BASE_FILES,
                previous_generation=first.name,
            )

            set_active(
                connection,
                second.name,
            )
            connection.rollback()

            if active(connection) != first.name:
                raise AssertionError(
                    "rolled back activation changed pointer"
                )

            set_active(
                connection,
                second.name,
            )
            connection.commit()

            meta = {
                "active_generation": active(
                    connection
                )
            }
            if (
                index_generation.resolve_active(
                    index_dir,
                    meta,
                )
                != second
            ):
                raise AssertionError(
                    "committed generation not active"
                )

            orphan = (
                index_generation.create_generation(
                    index_dir
                )
            )
            (
                orphan / "region_hashes.npy"
            ).write_bytes(b"partial")

            index_generation.cleanup_incomplete(
                index_dir
            )

            if orphan.exists():
                raise AssertionError(
                    "incomplete orphan not recovered"
                )

            if not first.exists():
                raise AssertionError(
                    "complete previous generation "
                    "was removed during recovery"
                )

            if not second.exists():
                raise AssertionError(
                    "active generation removed "
                    "during recovery"
                )
        finally:
            connection.close()


if __name__ == "__main__":
    main()
