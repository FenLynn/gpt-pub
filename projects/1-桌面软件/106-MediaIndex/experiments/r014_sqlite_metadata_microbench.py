from __future__ import annotations

import argparse
import hashlib
import os
import sqlite3
import statistics
import tempfile
import time


def make_hash(i: int) -> bytes:
    return hashlib.blake2b(i.to_bytes(8, "little"), digest_size=16).digest()


def percentile(values: list[float], p: float) -> float:
    values = sorted(values)
    if not values:
        return 0.0
    pos = (len(values) - 1) * p
    lo = int(pos)
    hi = min(lo + 1, len(values) - 1)
    frac = pos - lo
    return values[lo] * (1 - frac) + values[hi] * frac


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=500_000)
    parser.add_argument("--queries", type=int, default=500)
    parser.add_argument("--db", default="")
    args = parser.parse_args()

    if args.db:
        db_path = args.db
    else:
        db_path = os.path.join(
            tempfile.gettempdir(),
            "p106_sqlite_metadata_microbench.sqlite",
        )

    if os.path.exists(db_path):
        os.remove(db_path)

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.executescript(
        """
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA temp_store=MEMORY;

        CREATE TABLE files(
            id INTEGER PRIMARY KEY,
            storage_id INTEGER NOT NULL,
            relpath TEXT NOT NULL,
            size INTEGER NOT NULL,
            mtime INTEGER NOT NULL,
            width INTEGER,
            height INTEGER,
            exact_hash BLOB NOT NULL,
            status INTEGER NOT NULL DEFAULT 1
        );

        CREATE INDEX idx_files_hash
        ON files(exact_hash);

        CREATE INDEX idx_files_storage_path
        ON files(storage_id, relpath);

        CREATE TABLE image_signatures(
            file_id INTEGER PRIMARY KEY,
            global_hash BLOB NOT NULL
        );
        """
    )

    t0 = time.perf_counter()
    batch = []
    for i in range(args.rows):
        batch.append(
            (
                i + 1,
                i % 8,
                f"{i // 1000:04d}/IMG_{i:06d}.jpg",
                100_000 + i % 5_000_000,
                1_700_000_000 + i % 10_000_000,
                1920 + (i % 3) * 640,
                1080 + (i % 3) * 360,
                make_hash(i),
                1,
            )
        )
        if len(batch) >= 5000:
            cur.executemany(
                "INSERT INTO files VALUES(?,?,?,?,?,?,?,?,?)",
                batch,
            )
            batch.clear()
    if batch:
        cur.executemany(
            "INSERT INTO files VALUES(?,?,?,?,?,?,?,?,?)",
            batch,
        )
    conn.commit()
    files_insert_seconds = time.perf_counter() - t0

    t0 = time.perf_counter()
    signature_rows = []
    for i in range(args.rows):
        signature_rows.append(
            (
                i + 1,
                hashlib.blake2b(
                    b"sig" + i.to_bytes(8, "little"),
                    digest_size=8,
                ).digest(),
            )
        )
        if len(signature_rows) >= 5000:
            cur.executemany(
                "INSERT INTO image_signatures VALUES(?,?)",
                signature_rows,
            )
            signature_rows.clear()
    if signature_rows:
        cur.executemany(
            "INSERT INTO image_signatures VALUES(?,?)",
            signature_rows,
        )
    conn.commit()
    signature_insert_seconds = time.perf_counter() - t0

    sample_ids = [
        int(i * (args.rows - 1) / max(1, args.queries - 1))
        for i in range(args.queries)
    ]

    hash_ms = []
    path_ms = []
    for i in sample_ids:
        h = make_hash(i)
        t0 = time.perf_counter_ns()
        cur.execute(
            "SELECT id, storage_id, relpath FROM files WHERE exact_hash=?",
            (h,),
        ).fetchone()
        hash_ms.append((time.perf_counter_ns() - t0) / 1e6)

        storage_id = i % 8
        path = f"{i // 1000:04d}/IMG_{i:06d}.jpg"
        t0 = time.perf_counter_ns()
        cur.execute(
            "SELECT id, exact_hash FROM files "
            "WHERE storage_id=? AND relpath=?",
            (storage_id, path),
        ).fetchone()
        path_ms.append((time.perf_counter_ns() - t0) / 1e6)

    t0 = time.perf_counter()
    rows = cur.execute(
        "SELECT file_id, global_hash "
        "FROM image_signatures ORDER BY file_id"
    ).fetchall()
    sequential_load_seconds = time.perf_counter() - t0
    assert len(rows) == args.rows

    size_mib = os.path.getsize(db_path) / 1024**2

    print("SQLite metadata microbenchmark")
    print(f"rows={args.rows}")
    print(f"db_path={db_path}")
    print(f"db_size_mib={size_mib:.2f}")
    print(f"files_insert_seconds={files_insert_seconds:.3f}")
    print(f"signature_insert_seconds={signature_insert_seconds:.3f}")
    print(
        "exact_hash_query_ms="
        f"median:{statistics.median(hash_ms):.4f},"
        f"p95:{percentile(hash_ms, 0.95):.4f}"
    )
    print(
        "storage_path_query_ms="
        f"median:{statistics.median(path_ms):.4f},"
        f"p95:{percentile(path_ms, 0.95):.4f}"
    )
    print(f"signature_sequential_load_seconds={sequential_load_seconds:.3f}")

    conn.close()


if __name__ == "__main__":
    main()
