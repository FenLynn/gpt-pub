from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

import cv2
import numpy as np

import a004_real_image_acceptance_runner as image_engine
import local_feature_index as local_index


IMAGE_EXTS = image_engine.IMAGE_EXTS
SCHEMA_VERSION = 2


def index_id(library: Path) -> str:
    value = str(library.resolve()).casefold().encode("utf-8")
    return hashlib.sha256(value).hexdigest()[:16]


def json_write(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            payload,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def db_connect(index_dir: Path) -> sqlite3.Connection:
    index_dir.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(index_dir / "index.sqlite3")
    connection.row_factory = sqlite3.Row
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS meta(
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS images(
            id INTEGER PRIMARY KEY,
            relpath TEXT NOT NULL UNIQUE,
            size INTEGER NOT NULL,
            mtime_ns INTEGER NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            region_hashes BLOB NOT NULL,
            local_words BLOB,
            sha256 TEXT
        )
        """
    )
    columns = {
        row["name"]
        for row in connection.execute(
            "PRAGMA table_info(images)"
        )
    }

    if "local_words" not in columns:
        connection.execute(
            "ALTER TABLE images ADD COLUMN local_words BLOB"
        )
        connection.commit()

    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_images_size ON images(size)"
    )
    return connection


def set_meta(connection, key: str, value: str) -> None:
    connection.execute(
        """
        INSERT INTO meta(key,value)
        VALUES(?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
        """,
        (key, value),
    )


def load_meta(connection) -> dict[str, str]:
    return {
        row["key"]: row["value"]
        for row in connection.execute(
            "SELECT key,value FROM meta"
        )
    }


def scan_images(library: Path) -> list[Path]:
    return sorted(
        [
            path
            for path in library.rglob("*")
            if path.is_file()
            and path.suffix.lower() in IMAGE_EXTS
        ],
        key=lambda path: path.as_posix().casefold(),
    )


def build_index(
    library: Path,
    index_dir: Path,
    output: Path,
) -> None:
    started = time.perf_counter()
    library = library.resolve()

    if not library.is_dir():
        raise SystemExit(f"Image library not found: {library}")

    connection = db_connect(index_dir)

    try:
        meta = load_meta(connection)
        old_library = meta.get("library_root")
        if old_library and Path(old_library).resolve() != library:
            raise SystemExit(
                "Index directory belongs to another library. "
                f"Existing: {old_library}"
            )

        set_meta(connection, "schema_version", str(SCHEMA_VERSION))
        set_meta(connection, "library_root", str(library))

        existing = {
            row["relpath"]: row
            for row in connection.execute(
                """
                SELECT id,relpath,size,mtime_ns,width,height,
                       region_hashes,local_words,sha256
                FROM images
                """
            )
        }

        files = scan_images(library)
        seen = set()
        added = 0
        updated = 0
        reused = 0
        failed = []

        print(f"Scanning {len(files)} images...")

        for number, path in enumerate(files, start=1):
            relpath = path.relative_to(library).as_posix()
            seen.add(relpath)

            try:
                stat = path.stat()
            except OSError as exc:
                failed.append(
                    {
                        "file": relpath,
                        "error": str(exc),
                    }
                )
                continue

            row = existing.get(relpath)

            if (
                row is not None
                and int(row["size"]) == int(stat.st_size)
                and int(row["mtime_ns"]) == int(stat.st_mtime_ns)
                and row["region_hashes"]
                and row["local_words"] is not None
            ):
                reused += 1
            else:
                try:
                    image = image_engine.load_image(path)
                    hashes = image_engine.region_hashes(image)
                    local_words = local_index.extract_words(image)
                    local_blob = local_index.words_to_blob(
                        local_words
                    )
                    height, width = image.shape[:2]
                except Exception as exc:
                    failed.append(
                        {
                            "file": relpath,
                            "error": str(exc),
                        }
                    )
                    continue

                blob = hashes.astype(
                    "<u8",
                    copy=False,
                ).tobytes()

                if row is None:
                    connection.execute(
                        """
                        INSERT INTO images(
                            relpath,size,mtime_ns,width,height,
                            region_hashes,local_words,sha256
                        )
                        VALUES(?,?,?,?,?,?,?,NULL)
                        """,
                        (
                            relpath,
                            int(stat.st_size),
                            int(stat.st_mtime_ns),
                            int(width),
                            int(height),
                            blob,
                            local_blob,
                        ),
                    )
                    added += 1
                else:
                    connection.execute(
                        """
                        UPDATE images
                        SET size=?,mtime_ns=?,width=?,height=?,
                            region_hashes=?,local_words=?,sha256=NULL
                        WHERE relpath=?
                        """,
                        (
                            int(stat.st_size),
                            int(stat.st_mtime_ns),
                            int(width),
                            int(height),
                            blob,
                            local_blob,
                            relpath,
                        ),
                    )
                    updated += 1

            if number % 100 == 0 or number == len(files):
                print(
                    f"  {number}/{len(files)} "
                    f"added={added} updated={updated} reused={reused}"
                )

        removed = 0
        for relpath in set(existing) - seen:
            connection.execute(
                "DELETE FROM images WHERE relpath=?",
                (relpath,),
            )
            removed += 1

        connection.commit()

        rows = list(
            connection.execute(
                """
                SELECT id,region_hashes,local_words
                FROM images
                ORDER BY id
                """
            )
        )

        hash_count = None
        matrix_rows = []
        ids = []

        for row in rows:
            hashes = np.frombuffer(
                row["region_hashes"],
                dtype="<u8",
            ).copy()

            if hash_count is None:
                hash_count = len(hashes)

            if len(hashes) != hash_count:
                raise RuntimeError(
                    "Index contains inconsistent region hash counts"
                )

            matrix_rows.append(hashes)
            ids.append(int(row["id"]))

        if matrix_rows:
            matrix = np.stack(matrix_rows)
            id_array = np.asarray(ids, dtype=np.int64)
        else:
            matrix = np.empty((0, 0), dtype=np.uint64)
            id_array = np.empty((0,), dtype=np.int64)

        matrix_tmp = index_dir / "region_hashes.tmp.npy"
        ids_tmp = index_dir / "image_ids.tmp.npy"

        np.save(matrix_tmp, matrix)
        np.save(ids_tmp, id_array)

        os.replace(
            matrix_tmp,
            index_dir / "region_hashes.npy",
        )
        os.replace(
            ids_tmp,
            index_dir / "image_ids.npy",
        )

        local_stats = local_index.build_index_arrays(
            index_dir,
            [
                (
                    int(row["id"]),
                    row["local_words"],
                )
                for row in rows
            ],
            len(rows),
        )

        set_meta(
            connection,
            "indexed_count",
            str(len(rows)),
        )
        set_meta(
            connection,
            "last_build_unix",
            str(time.time()),
        )
        connection.commit()

        elapsed = time.perf_counter() - started

        payload = {
            "ok": True,
            "library_root": str(library),
            "index_dir": str(index_dir.resolve()),
            "index_id": index_id(library),
            "images": len(rows),
            "added": added,
            "updated": updated,
            "reused": reused,
            "removed": removed,
            "failed": len(failed),
            "failures": failed[:50],
            "seconds": elapsed,
            "matrix_bytes": int(matrix.nbytes),
            **local_stats,
        }

        json_write(output, payload)
        print(json.dumps(payload, ensure_ascii=False, indent=2))

    finally:
        connection.close()


def ensure_index_files(index_dir: Path):
    database = index_dir / "index.sqlite3"
    matrix = index_dir / "region_hashes.npy"
    ids = index_dir / "image_ids.npy"

    if not database.exists() or not matrix.exists() or not ids.exists():
        raise SystemExit(
            f"Incomplete MediaIndex image index: {index_dir}"
        )


def score_candidates(
    query_hashes: np.ndarray,
    matrix: np.ndarray,
) -> np.ndarray:
    if len(matrix) == 0:
        return np.empty((0,), dtype=np.int16)

    query_hashes = np.asarray(
        query_hashes,
        dtype=np.uint64,
    )

    # Query-global against every stored source region.
    first = np.bitwise_count(
        matrix ^ query_hashes[0]
    ).min(axis=1)

    # Every query region against source-global.
    second = np.bitwise_count(
        matrix[:, 0][:, None]
        ^ query_hashes[None, :]
    ).min(axis=1)

    return np.minimum(first, second).astype(np.int16)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def lazy_exact_match(
    connection: sqlite3.Connection,
    library: Path,
    query: Path,
    candidate_rows: list[sqlite3.Row],
) -> int | None:
    try:
        query_size = query.stat().st_size
    except OSError:
        return None

    same_size = [
        row
        for row in candidate_rows
        if int(row["size"]) == int(query_size)
    ]

    if not same_size:
        return None

    query_hash = sha256_file(query)

    for row in same_size:
        source = library / row["relpath"]
        if not source.is_file():
            continue

        current = row["sha256"]
        if not current:
            current = sha256_file(source)
            connection.execute(
                "UPDATE images SET sha256=? WHERE id=?",
                (
                    current,
                    int(row["id"]),
                ),
            )

        if current == query_hash:
            connection.commit()
            return int(row["id"])

    connection.commit()
    return None


def query_image(
    index_dir: Path,
    query: Path,
    output: Path,
    top_k: int,
    verify_k: int,
) -> None:
    started = time.perf_counter()
    ensure_index_files(index_dir)

    connection = db_connect(index_dir)

    try:
        meta = load_meta(connection)
        library_value = meta.get("library_root")
        if not library_value:
            raise SystemExit("Index has no library_root metadata")

        library = Path(library_value)
        matrix = np.load(
            index_dir / "region_hashes.npy",
            mmap_mode="r",
        )
        ids = np.load(
            index_dir / "image_ids.npy",
            mmap_mode="r",
        )

        image = image_engine.load_image(query)
        query_hashes = image_engine.region_hashes(image)

        candidate_started = time.perf_counter()
        scores = score_candidates(
            query_hashes,
            matrix,
        )

        if len(scores) == 0:
            payload = {
                "ok": True,
                "query": str(query),
                "results": [],
                "candidate_ms": 0.0,
                "total_ms": (
                    time.perf_counter() - started
                ) * 1000,
            }
            json_write(output, payload)
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            return

        keep = min(
            max(1, top_k),
            len(scores),
        )

        if keep == len(scores):
            phash_order = np.argsort(scores)
        else:
            partial = np.argpartition(
                scores,
                keep - 1,
            )[:keep]
            phash_order = partial[
                np.argsort(scores[partial])
            ]

        phash_ids = [
            int(ids[index])
            for index in phash_order
        ]

        query_local_words = local_index.extract_words(
            image
        )
        local_ids_array, local_scores_array, local_meta = (
            local_index.search_index(
                index_dir,
                query_local_words,
                top_k,
            )
        )

        local_ids = [
            int(value)
            for value in local_ids_array
        ]

        phash_rank = {
            image_id: rank
            for rank, image_id in enumerate(
                phash_ids,
                start=1,
            )
        }
        local_rank = {
            image_id: rank
            for rank, image_id in enumerate(
                local_ids,
                start=1,
            )
        }
        local_score_by_id = {
            image_id: float(score)
            for image_id, score in zip(
                local_ids,
                local_scores_array,
            )
        }

        union_ids = set(phash_ids)
        union_ids.update(local_ids)

        def rrf_score(image_id: int) -> float:
            value = 0.0

            if image_id in phash_rank:
                value += 1.0 / (
                    20.0 + phash_rank[image_id]
                )

            if image_id in local_rank:
                value += 1.0 / (
                    20.0 + local_rank[image_id]
                )

            return value

        ordered_ids = sorted(
            union_ids,
            key=lambda image_id: (
                -rrf_score(image_id),
                phash_rank.get(image_id, 10**9),
                local_rank.get(image_id, 10**9),
                image_id,
            ),
        )

        candidate_ms = (
            time.perf_counter()
            - candidate_started
        ) * 1000

        placeholders = ",".join(
            "?"
            for _ in ordered_ids
        )

        row_map = {
            int(row["id"]): row
            for row in connection.execute(
                f"""
                SELECT id,relpath,size,mtime_ns,width,height,
                       region_hashes,sha256
                FROM images
                WHERE id IN ({placeholders})
                """,
                ordered_ids,
            )
        }

        candidate_rows = [
            row_map[item_id]
            for item_id in ordered_ids
            if item_id in row_map
        ]

        exact_id = lazy_exact_match(
            connection,
            library,
            query,
            candidate_rows,
        )

        score_by_id = {}

        for image_id in ordered_ids:
            position = int(
                np.searchsorted(
                    ids,
                    image_id,
                )
            )

            if (
                position < len(ids)
                and int(ids[position]) == image_id
            ):
                score_by_id[image_id] = int(
                    scores[position]
                )

        candidate_lane_by_id = {
            image_id: (
                "A+B"
                if (
                    image_id in phash_rank
                    and image_id in local_rank
                )
                else "A"
                if image_id in phash_rank
                else "B"
            )
            for image_id in ordered_ids
        }

        detector = cv2.SIFT_create(
            nfeatures=2200,
            contrastThreshold=0.02,
            edgeThreshold=10,
            sigma=1.6,
        )
        matcher = cv2.BFMatcher(
            cv2.NORM_L2
        )
        query_feature = image_engine.extract_sift(
            detector,
            image,
        )

        verified = []

        for row in candidate_rows[
            : min(verify_k, len(candidate_rows))
        ]:
            source_path = library / row["relpath"]
            online = source_path.is_file()

            item = {
                "id": int(row["id"]),
                "relpath": row["relpath"],
                "path": str(source_path),
                "online": bool(online),
                "phash_distance": score_by_id.get(
                    int(row["id"]),
                    999,
                ),
                "local_score": local_score_by_id.get(
                    int(row["id"]),
                    0.0,
                ),
                "candidate_lane": candidate_lane_by_id.get(
                    int(row["id"]),
                    "",
                ),
                "phash_rank": phash_rank.get(
                    int(row["id"])
                ),
                "local_rank": local_rank.get(
                    int(row["id"])
                ),
                "exact": bool(
                    exact_id is not None
                    and int(row["id"]) == exact_id
                ),
                "verification_score": 0.0,
                "confirmed_baseline": False,
                "inliers": 0,
                "ratio": 0.0,
                "query_coverage": 0.0,
                "ncc": 0.0,
                "template_score": None,
            }

            if online:
                try:
                    source_image = image_engine.load_image(
                        source_path
                    )
                    source_feature = image_engine.extract_sift(
                        detector,
                        source_image,
                    )
                    metrics = image_engine.verify_pair(
                        matcher,
                        query_feature,
                        source_feature,
                    )
                    item.update(metrics)
                    item["verification_score"] = float(
                        metrics["inliers"] * 2.0
                        + metrics["ratio"] * 20.0
                        + metrics["query_coverage"] * 20.0
                        + max(-1.0, metrics["ncc"]) * 30.0
                    )
                except Exception as exc:
                    item["verification_error"] = str(exc)

            verified.append(item)

        confirmed = [
            item
            for item in verified
            if item.get("confirmed_baseline")
        ]

        if exact_id is not None:
            verified.sort(
                key=lambda item: (
                    item["exact"],
                    item.get("confirmed_baseline", False),
                    item.get("verification_score", 0.0),
                    -item["phash_distance"],
                ),
                reverse=True,
            )
            ranking_mode = "exact"
        elif confirmed:
            verified.sort(
                key=lambda item: (
                    item.get("confirmed_baseline", False),
                    item.get("verification_score", 0.0),
                    -item["phash_distance"],
                ),
                reverse=True,
            )
            ranking_mode = "confirmed_verifier"
        else:
            shortlist = verified[:]
            source_cache = {}

            for item in shortlist:
                if not item["online"]:
                    continue

                try:
                    source_path = Path(item["path"])
                    source_image = image_engine.load_image(
                        source_path
                    )
                    source_feature = image_engine.extract_sift(
                        detector,
                        source_image,
                    )
                    source_cache[item["id"]] = source_feature
                    item["template_score"] = (
                        image_engine.template_fallback_score(
                            query_feature[0],
                            source_feature[0],
                        )
                    )
                except Exception as exc:
                    item["template_error"] = str(exc)

            verified.sort(
                key=lambda item: (
                    -float(
                        item["template_score"]
                        if item["template_score"] is not None
                        else -1.0
                    ),
                    item["phash_distance"],
                    -item.get(
                        "verification_score",
                        0.0,
                    ),
                )
            )
            ranking_mode = "template_fallback"

        results = []

        for rank, item in enumerate(verified, start=1):
            if item["exact"]:
                confidence = "Exact"
            elif item.get("confirmed_baseline"):
                confidence = "Confirmed"
            elif rank == 1:
                template = item.get("template_score")
                if (
                    template is not None
                    and float(template) >= 0.50
                ):
                    confidence = "Probable"
                else:
                    confidence = "Candidate"
            else:
                confidence = "Candidate"

            results.append(
                {
                    **item,
                    "rank": rank,
                    "confidence": confidence,
                }
            )

        total_ms = (
            time.perf_counter()
            - started
        ) * 1000

        payload = {
            "ok": True,
            "query": str(query.resolve()),
            "library_root": str(library),
            "index_dir": str(index_dir.resolve()),
            "indexed_images": int(len(matrix)),
            "ranking_mode": ranking_mode,
            "candidate_ms": candidate_ms,
            "lane_a_candidates": int(len(phash_ids)),
            "lane_b_candidates": int(len(local_ids)),
            "candidate_union_count": int(len(ordered_ids)),
            "lane_b_ready": bool(
                local_index.index_available(index_dir)
            ),
            "lane_b_query_words": int(
                len(query_local_words)
            ),
            "lane_b_postings_touched": int(
                local_meta["postings_touched"]
            ),
            "lane_b_query_ms": float(
                local_meta["query_ms"]
            ),
            "total_ms": total_ms,
            "results": results[:10],
        }

        json_write(output, payload)
        print(json.dumps(payload, ensure_ascii=False, indent=2))

    finally:
        connection.close()


def index_info(
    index_dir: Path,
    output: Path,
) -> None:
    ensure_index_files(index_dir)
    connection = db_connect(index_dir)

    try:
        meta = load_meta(connection)
        count = int(
            connection.execute(
                "SELECT COUNT(*) AS n FROM images"
            ).fetchone()["n"]
        )

        payload = {
            "ok": True,
            "index_dir": str(index_dir.resolve()),
            "library_root": meta.get("library_root", ""),
            "images": count,
            "local_lane_ready": bool(
                local_index.index_available(index_dir)
            ),
            "local_postings_bytes": int(
                (index_dir / "local_postings.npy").stat().st_size
                if (index_dir / "local_postings.npy").is_file()
                else 0
            ),
            "schema_version": meta.get(
                "schema_version",
                "",
            ),
            "last_build_unix": meta.get(
                "last_build_unix",
                "",
            ),
        }

        json_write(output, payload)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="MediaIndex persistent image core"
    )
    sub = parser.add_subparsers(
        dest="command",
        required=True,
    )

    build = sub.add_parser("build-index")
    build.add_argument("--library", required=True)
    build.add_argument("--index-dir", required=True)
    build.add_argument("--output", required=True)

    query = sub.add_parser("query-image")
    query.add_argument("--index-dir", required=True)
    query.add_argument("--query", required=True)
    query.add_argument("--output", required=True)
    query.add_argument("--topk", type=int, default=50)
    query.add_argument("--verify-k", type=int, default=8)

    info = sub.add_parser("index-info")
    info.add_argument("--index-dir", required=True)
    info.add_argument("--output", required=True)

    args = parser.parse_args()

    if args.command == "build-index":
        build_index(
            Path(args.library),
            Path(args.index_dir),
            Path(args.output),
        )
        return

    if args.command == "query-image":
        query_image(
            Path(args.index_dir),
            Path(args.query),
            Path(args.output),
            max(1, args.topk),
            max(1, args.verify_k),
        )
        return

    if args.command == "index-info":
        index_info(
            Path(args.index_dir),
            Path(args.output),
        )
        return


if __name__ == "__main__":
    main()
