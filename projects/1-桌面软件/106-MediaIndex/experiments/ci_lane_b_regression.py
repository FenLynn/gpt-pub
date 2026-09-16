from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

import ci_acceptance_regression as fixtures
import local_feature_index as lane_b
import mediaindex_core as core


WIDTH = 1200
HEIGHT = 900
PATCH_W = 230
PATCH_H = 170


def common_background() -> np.ndarray:
    yy, xx = np.mgrid[0:HEIGHT, 0:WIDTH]
    image = np.empty(
        (HEIGHT, WIDTH, 3),
        dtype=np.uint8,
    )

    base = (
        105
        + 20 * np.sin(xx / 145.0)
        + 17 * np.cos(yy / 117.0)
    )

    image[..., 0] = np.clip(
        base + 25,
        0,
        255,
    )
    image[..., 1] = np.clip(
        base + 45,
        0,
        255,
    )
    image[..., 2] = np.clip(
        base + 62,
        0,
        255,
    )

    for y in range(90, HEIGHT, 150):
        for x in range(90, WIDTH, 170):
            cv2.circle(
                image,
                (x, y),
                18,
                (75, 95, 120),
                2,
            )

    for x in range(120, WIDTH, 240):
        cv2.line(
            image,
            (x, 0),
            (x, HEIGHT),
            (150, 160, 175),
            1,
        )

    return image


def build_scene(seed: int):
    image = common_background()

    patch = fixtures.rich_image(
        900 + seed
    )
    patch = cv2.resize(
        patch,
        (PATCH_W, PATCH_H),
        interpolation=cv2.INTER_AREA,
    )

    positions = (
        (38, 42),
        (WIDTH - PATCH_W - 38, 42),
        (38, HEIGHT - PATCH_H - 42),
        (
            WIDTH - PATCH_W - 38,
            HEIGHT - PATCH_H - 42,
        ),
    )

    x, y = positions[seed % len(positions)]

    cv2.rectangle(
        image,
        (x - 5, y - 5),
        (x + PATCH_W + 5, y + PATCH_H + 5),
        (245, 245, 245),
        -1,
    )

    image[
        y:y + PATCH_H,
        x:x + PATCH_W,
    ] = patch

    return image, (
        x,
        y,
        x + PATCH_W,
        y + PATCH_H,
    )


def save_jpeg(
    path: Path,
    image: np.ndarray,
    quality: int = 91,
) -> None:
    ok, encoded = cv2.imencode(
        ".jpg",
        image,
        [cv2.IMWRITE_JPEG_QUALITY, quality],
    )
    if not ok:
        raise RuntimeError("JPEG encode failed")
    encoded.tofile(str(path))


def run_core(argv: list[str]) -> None:
    original = sys.argv[:]
    try:
        sys.argv = [original[0], *argv]
        core.main()
    finally:
        sys.argv = original


def phash_top_ids(
    index_dir: Path,
    query: np.ndarray,
    top_k: int,
) -> list[int]:
    matrix = np.load(
        index_dir / "region_hashes.npy",
        mmap_mode="r",
    )
    ids = np.load(
        index_dir / "image_ids.npy",
        mmap_mode="r",
    )

    scores = core.score_candidates(
        core.image_engine.region_hashes(query),
        matrix,
    )

    keep = min(top_k, len(scores))

    if keep == len(scores):
        order = np.argsort(scores)
    else:
        partial = np.argpartition(
            scores,
            keep - 1,
        )[:keep]
        order = partial[
            np.argsort(scores[partial])
        ]

    return [
        int(ids[index])
        for index in order
    ]


def main() -> None:
    with tempfile.TemporaryDirectory(
        prefix="p106-lane-b-"
    ) as temp:
        root = Path(temp)
        library = root / "library"
        queries = root / "queries"
        index_dir = root / "index"
        library.mkdir()
        queries.mkdir()

        source_boxes = {}

        for seed in range(24):
            image, box = build_scene(seed)
            name = f"scene_{seed:02d}.jpg"
            save_jpeg(
                library / name,
                image,
            )
            source_boxes[seed] = box

        build_output = root / "build.json"
        run_core(
            [
                "build-index",
                "--library", str(library),
                "--index-dir", str(index_dir),
                "--output", str(build_output),
            ]
        )

        build = json.loads(
            build_output.read_text(
                encoding="utf-8"
            )
        )

        if build.get("local_postings", 0) <= 0:
            raise AssertionError(build)

        connection = sqlite3.connect(
            index_dir / "index.sqlite3"
        )
        try:
            id_by_name = {
                relpath: int(image_id)
                for image_id, relpath in connection.execute(
                    "SELECT id,relpath FROM images"
                )
            }
        finally:
            connection.close()

        local5 = 0
        local20 = 0
        phash5 = 0
        union20 = 0
        rescues = 0
        integrated_top1 = 0
        details = []

        for seed in range(12):
            source_name = f"scene_{seed:02d}.jpg"
            source_id = id_by_name[source_name]

            source = core.image_engine.load_image(
                library / source_name
            )
            x1, y1, x2, y2 = source_boxes[seed]

            query_image = source[
                y1:y2,
                x1:x2,
            ].copy()

            query_image = cv2.resize(
                query_image,
                (
                    int(round(query_image.shape[1] * 0.82)),
                    int(round(query_image.shape[0] * 0.82)),
                ),
                interpolation=cv2.INTER_AREA,
            )

            query_path = queries / f"query_{seed:02d}.jpg"
            save_jpeg(
                query_path,
                query_image,
                quality=73,
            )

            words = lane_b.extract_words(
                query_image
            )
            local_ids, _, meta = lane_b.search_index(
                index_dir,
                words,
                top_k=20,
            )
            local_list = [
                int(value)
                for value in local_ids
            ]

            phash_list = phash_top_ids(
                index_dir,
                query_image,
                top_k=20,
            )

            union = list(
                dict.fromkeys(
                    local_list + phash_list
                )
            )[:20]

            in_local5 = source_id in local_list[:5]
            in_local20 = source_id in local_list[:20]
            in_phash5 = source_id in phash_list[:5]
            in_union20 = source_id in union

            local5 += int(in_local5)
            local20 += int(in_local20)
            phash5 += int(in_phash5)
            union20 += int(in_union20)
            rescues += int(
                in_local20
                and source_id not in phash_list[:20]
            )

            integrated = None

            if seed < 4:
                output = root / f"full_{seed:02d}.json"
                run_core(
                    [
                        "query-image",
                        "--index-dir", str(index_dir),
                        "--query", str(query_path),
                        "--output", str(output),
                        "--topk", "20",
                        "--verify-k", "10",
                    ]
                )
                integrated = json.loads(
                    output.read_text(
                        encoding="utf-8"
                    )
                )
                top = (
                    integrated["results"][0]
                    if integrated["results"]
                    else {}
                )
                integrated_top1 += int(
                    top.get("relpath")
                    == source_name
                )

            details.append(
                {
                    "query": query_path.name,
                    "source": source_name,
                    "local_rank": (
                        local_list.index(source_id) + 1
                        if source_id in local_list
                        else None
                    ),
                    "phash_rank": (
                        phash_list.index(source_id) + 1
                        if source_id in phash_list
                        else None
                    ),
                    "local_words": int(len(words)),
                    "postings_touched": int(
                        meta["postings_touched"]
                    ),
                    "integrated_top1": (
                        None
                        if integrated is None
                        else integrated["results"][0]["relpath"]
                        if integrated["results"]
                        else None
                    ),
                }
            )

        summary = {
            "ok": True,
            "queries": 12,
            "local_top5": local5,
            "local_top20": local20,
            "phash_top5": phash5,
            "union_top20": union20,
            "lane_b_top5_rescues": rescues,
            "integrated_top1_first4": integrated_top1,
            "build": {
                "images": build["images"],
                "local_postings": build[
                    "local_postings"
                ],
                "local_postings_bytes": build[
                    "local_postings_bytes"
                ],
            },
            "details": details,
        }

        print(
            json.dumps(
                summary,
                ensure_ascii=False,
                indent=2,
            )
        )

        if local20 < 12:
            raise AssertionError(summary)

        if union20 < 12:
            raise AssertionError(summary)

        if rescues < 2:
            raise AssertionError(summary)

        if integrated_top1 < 4:
            raise AssertionError(summary)


if __name__ == "__main__":
    main()
