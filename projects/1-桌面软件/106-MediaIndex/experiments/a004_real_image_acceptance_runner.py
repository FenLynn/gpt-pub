from __future__ import annotations

import argparse
import csv
import hashlib
import json
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
import pillow_heif


pillow_heif.register_heif_opener()


IMAGE_EXTS = {
    ".jpg", ".jpeg", ".png", ".webp", ".bmp",
    ".tif", ".tiff", ".heic", ".heif",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def load_image(path: Path) -> np.ndarray:
    if path.suffix.lower() in {".heic", ".heif"}:
        with Image.open(path) as source:
            rgb = np.asarray(source.convert("RGB"))
        return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

    data = np.fromfile(str(path), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Cannot decode image: {path}")
    return image


def resize_max(image: np.ndarray, max_dim: int = 1400) -> np.ndarray:
    height, width = image.shape[:2]
    scale = min(1.0, max_dim / max(height, width))
    if scale >= 1.0:
        return image
    return cv2.resize(
        image,
        (
            max(1, int(round(width * scale))),
            max(1, int(round(height * scale))),
        ),
        interpolation=cv2.INTER_AREA,
    )


def phash64(image: np.ndarray) -> np.uint64:
    if image.ndim == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image
    small = cv2.resize(
        gray,
        (32, 32),
        interpolation=cv2.INTER_AREA,
    ).astype(np.float32)
    values = cv2.dct(small)[:8, :8].ravel()
    median = np.median(values[1:])
    output = np.uint64(0)
    for index, value in enumerate(values > median):
        if value:
            output |= np.uint64(1) << np.uint64(index)
    return output


def region_boxes(width: int, height: int):
    boxes = [(0, 0, width, height)]

    for keep in (0.80, 0.60, 0.40):
        crop_w = max(16, int(round(width * keep)))
        crop_h = max(16, int(round(height * keep)))
        for y_fraction in (0.0, 0.5, 1.0):
            for x_fraction in (0.0, 0.5, 1.0):
                x = int(round((width - crop_w) * x_fraction))
                y = int(round((height - crop_h) * y_fraction))
                boxes.append(
                    (
                        x,
                        y,
                        min(width, x + crop_w),
                        min(height, y + crop_h),
                    )
                )
    return boxes


def region_hashes(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    hashes = []
    for x1, y1, x2, y2 in region_boxes(width, height):
        crop = image[y1:y2, x1:x2]
        if crop.size:
            hashes.append(phash64(crop))
    return np.asarray(hashes, dtype=np.uint64)


def candidate_distance(
    query_hashes: np.ndarray,
    source_hashes: np.ndarray,
) -> int:
    distance = np.bitwise_count(
        query_hashes[:, None] ^ source_hashes[None, :]
    )
    return int(distance.min())


def coverage(points: np.ndarray, width: int, height: int) -> float:
    if len(points) < 3:
        return 0.0
    hull = cv2.convexHull(
        np.asarray(points, dtype=np.float32).reshape(-1, 1, 2)
    )
    return float(
        abs(cv2.contourArea(hull)) / max(1, width * height)
    )


def ncc_after_warp(
    query_gray: np.ndarray,
    source_gray: np.ndarray,
    homography: np.ndarray,
) -> float:
    height, width = source_gray.shape
    warped = cv2.warpPerspective(
        query_gray,
        homography,
        (width, height),
        flags=cv2.INTER_LINEAR,
        borderValue=0,
    )
    mask = (
        cv2.warpPerspective(
            np.ones(query_gray.shape, dtype=np.uint8) * 255,
            homography,
            (width, height),
            flags=cv2.INTER_NEAREST,
            borderValue=0,
        )
        > 0
    )
    left = warped[mask].astype(np.float32)
    right = source_gray[mask].astype(np.float32)
    if (
        left.size < 200
        or left.std() < 1e-6
        or right.std() < 1e-6
    ):
        return 0.0
    return float(np.corrcoef(left, right)[0, 1])


def resize_gray_max(
    gray: np.ndarray,
    max_dim: int = 360,
) -> np.ndarray:
    height, width = gray.shape
    scale = min(
        1.0,
        max_dim / max(height, width),
    )
    if scale >= 1.0:
        return gray
    return cv2.resize(
        gray,
        (
            max(16, int(round(width * scale))),
            max(16, int(round(height * scale))),
        ),
        interpolation=cv2.INTER_AREA,
    )


def template_fallback_score(
    query_gray: np.ndarray,
    source_gray: np.ndarray,
) -> float:
    source = resize_gray_max(source_gray)
    query = resize_gray_max(query_gray)

    source_edge = cv2.Canny(
        source,
        60,
        140,
    )

    scale_values = (
        0.50,
        0.60,
        0.70,
        0.75,
        0.80,
        0.90,
        1.00,
    )

    best = -1.0

    for scale_y in scale_values:
        for scale_x in scale_values:
            width = max(
                20,
                int(round(query.shape[1] * scale_x)),
            )
            height = max(
                20,
                int(round(query.shape[0] * scale_y)),
            )

            if (
                width > source.shape[1]
                or height > source.shape[0]
            ):
                continue

            candidate = cv2.resize(
                query,
                (width, height),
                interpolation=(
                    cv2.INTER_AREA
                    if scale_x < 1.0 or scale_y < 1.0
                    else cv2.INTER_LINEAR
                ),
            )

            gray_result = cv2.matchTemplate(
                source,
                candidate,
                cv2.TM_CCOEFF_NORMED,
            )
            gray_score = float(
                np.nanmax(gray_result)
            )

            candidate_edge = cv2.Canny(
                candidate,
                60,
                140,
            )

            edge_score = 0.0
            if (
                np.count_nonzero(candidate_edge) >= 30
                and np.count_nonzero(source_edge) >= 30
            ):
                edge_result = cv2.matchTemplate(
                    source_edge,
                    candidate_edge,
                    cv2.TM_CCOEFF_NORMED,
                )
                edge_score = float(
                    np.nanmax(edge_result)
                )

            score = (
                0.75 * gray_score
                + 0.25 * max(0.0, edge_score)
            )
            best = max(best, score)

    return float(best)


def extract_sift(detector, image: np.ndarray):
    image = resize_max(image)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    keypoints, descriptors = detector.detectAndCompute(gray, None)
    return gray, keypoints, descriptors


def verify_pair(matcher, query_feature, source_feature):
    query_gray, query_keypoints, query_descriptors = query_feature
    source_gray, source_keypoints, source_descriptors = source_feature

    empty = {
        "good_matches": 0,
        "inliers": 0,
        "ratio": 0.0,
        "query_fraction": 0.0,
        "query_coverage": 0.0,
        "source_coverage": 0.0,
        "ncc": 0.0,
        "confirmed_baseline": False,
    }

    if (
        query_descriptors is None
        or source_descriptors is None
        or len(query_descriptors) < 2
        or len(source_descriptors) < 2
    ):
        return empty

    pairs = matcher.knnMatch(
        query_descriptors,
        source_descriptors,
        k=2,
    )

    good = [
        pair[0]
        for pair in pairs
        if len(pair) >= 2
        and pair[0].distance < 0.75 * pair[1].distance
    ]

    if len(good) < 4:
        return {
            **empty,
            "good_matches": len(good),
        }

    source_points = np.float32(
        [query_keypoints[item.queryIdx].pt for item in good]
    ).reshape(-1, 1, 2)

    target_points = np.float32(
        [source_keypoints[item.trainIdx].pt for item in good]
    ).reshape(-1, 1, 2)

    homography, mask = cv2.findHomography(
        source_points,
        target_points,
        cv2.RANSAC,
        4.0,
    )

    if homography is None or mask is None:
        return {
            **empty,
            "good_matches": len(good),
        }

    inlier_mask = mask.ravel().astype(bool)
    inliers = int(inlier_mask.sum())
    query_inlier_points = source_points.reshape(-1, 2)[inlier_mask]
    source_inlier_points = target_points.reshape(-1, 2)[inlier_mask]

    ratio = inliers / max(1, len(good))
    query_fraction = inliers / max(1, len(query_keypoints))
    query_coverage = coverage(
        query_inlier_points,
        query_gray.shape[1],
        query_gray.shape[0],
    )
    source_coverage = coverage(
        source_inlier_points,
        source_gray.shape[1],
        source_gray.shape[0],
    )
    ncc = ncc_after_warp(
        query_gray,
        source_gray,
        homography,
    )

    confirmed = (
        inliers >= 12
        and ratio >= 0.75
        and query_coverage >= 0.05
        and ncc >= 0.88
    )

    return {
        "good_matches": len(good),
        "inliers": inliers,
        "ratio": float(ratio),
        "query_fraction": float(query_fraction),
        "query_coverage": float(query_coverage),
        "source_coverage": float(source_coverage),
        "ncc": float(ncc),
        "confirmed_baseline": bool(confirmed),
    }


def resolve_query(raw: str, manifest: Path) -> Path:
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = manifest.parent / path
    return path.resolve()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="P106 A4 real-domain image acceptance runner"
    )
    parser.add_argument("--library", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--topk", type=int, default=50)
    parser.add_argument(
        "--output",
        default="a004_results.json",
    )
    args = parser.parse_args()

    library_root = Path(args.library).resolve()
    manifest = Path(args.manifest).resolve()
    topk = max(1, args.topk)

    library_paths = sorted(
        path
        for path in library_root.rglob("*")
        if path.is_file()
        and path.suffix.lower() in IMAGE_EXTS
    )

    if not library_paths:
        raise SystemExit("No library images found")

    detector = cv2.SIFT_create(
        nfeatures=2200,
        contrastThreshold=0.02,
        edgeThreshold=10,
        sigma=1.6,
    )
    matcher = cv2.BFMatcher(cv2.NORM_L2)

    index = []

    print(f"Indexing {len(library_paths)} library images...")

    for number, path in enumerate(library_paths, start=1):
        image = load_image(path)
        index.append(
            {
                "name": path.relative_to(library_root).as_posix(),
                "path": path,
                "sha256": sha256(path),
                "region_hashes": region_hashes(image),
                "sift": extract_sift(detector, image),
            }
        )
        if number % 25 == 0 or number == len(library_paths):
            print(f"  {number}/{len(library_paths)}")

    rows = list(
        csv.DictReader(
            manifest.open(
                "r",
                encoding="utf-8-sig",
                newline="",
            )
        )
    )

    results = []

    for row_index, row in enumerate(rows, start=1):
        started = time.perf_counter()
        query_path = resolve_query(row["query"], manifest)
        expected_source = (
            row.get("expected_source", "")
            .replace("\\", "/")
            .strip()
            .lstrip("./")
        )
        relation = row.get("relation", "").strip()

        query_image = load_image(query_path)
        query_sha = sha256(query_path)
        query_hashes = region_hashes(query_image)

        exact_hits = [
            item
            for item in index
            if item["sha256"] == query_sha
        ]

        candidate_rows = []

        if exact_hits:
            for item in exact_hits:
                candidate_rows.append(
                    (
                        -1,
                        item,
                    )
                )
        else:
            for item in index:
                candidate_rows.append(
                    (
                        candidate_distance(
                            query_hashes,
                            item["region_hashes"],
                        ),
                        item,
                    )
                )

            candidate_rows.sort(key=lambda item: item[0])
            candidate_rows = candidate_rows[: min(topk, len(candidate_rows))]

        candidate_names = [item[1]["name"] for item in candidate_rows]
        expected_in_topk = (
            expected_source in candidate_names
            if expected_source
            else None
        )

        query_feature = extract_sift(detector, query_image)
        verified = []

        for distance, item in candidate_rows:
            metrics = verify_pair(
                matcher,
                query_feature,
                item["sift"],
            )
            verification_score = (
                metrics["inliers"] * 2.0
                + metrics["ratio"] * 20.0
                + metrics["query_coverage"] * 20.0
                + max(-1.0, metrics["ncc"]) * 30.0
            )
            verified.append(
                {
                    "source": item["name"],
                    "phash_distance": int(distance),
                    "verification_score": float(verification_score),
                    **metrics,
                }
            )

        has_confirmed_candidate = any(
            item["confirmed_baseline"]
            for item in verified
        )

        if has_confirmed_candidate:
            verified.sort(
                key=lambda item: (
                    item["confirmed_baseline"],
                    item["verification_score"],
                    -item["phash_distance"],
                ),
                reverse=True,
            )
            ranking_mode = "confirmed_verifier"
        else:
            # Low-confidence geometry is exactly where the Round1
            # acceptance exposed wrong Top-1 choices. First keep a
            # very small pHash shortlist, then use a low-resolution,
            # anisotropic grayscale/edge template fallback. This is
            # candidate-only work, never a full-library template scan.
            verified.sort(
                key=lambda item: (
                    item["phash_distance"],
                    -item["verification_score"],
                )
            )

            shortlist = verified[: min(8, len(verified))]
            item_by_name = {
                item["name"]: item
                for item in index
            }

            for candidate in shortlist:
                source_item = item_by_name[
                    candidate["source"]
                ]
                candidate["template_score"] = (
                    template_fallback_score(
                        query_feature[0],
                        source_item["sift"][0],
                    )
                )

            for candidate in verified[len(shortlist):]:
                candidate["template_score"] = None

            shortlist.sort(
                key=lambda item: (
                    -float(item["template_score"]),
                    item["phash_distance"],
                    -item["verification_score"],
                )
            )

            verified = (
                shortlist
                + verified[len(shortlist):]
            )
            ranking_mode = "template_fallback"

        top = verified[0] if verified else None
        false_confirmed = (
            not expected_source
            and any(
                item["confirmed_baseline"]
                for item in verified
            )
        )
        correct_confirmed = (
            bool(expected_source)
            and top is not None
            and top["source"] == expected_source
            and top["confirmed_baseline"]
        )

        elapsed_ms = (
            time.perf_counter() - started
        ) * 1000

        record = {
            "query_id": row_index,
            "query_name": query_path.name,
            "relation": relation,
            "is_positive": bool(expected_source),
            "expected_source": expected_source,
            "candidate_topk": len(candidate_rows),
            "expected_in_topk": expected_in_topk,
            "top1_source": top["source"] if top else "",
            "top1_correct": (
                top["source"] == expected_source
                if top and expected_source
                else None
            ),
            "correct_confirmed_baseline": bool(correct_confirmed),
            "false_confirmed_baseline": bool(false_confirmed),
            "query_ms": float(elapsed_ms),
            "ranking_mode": ranking_mode,
            "top_candidates": verified[:10],
        }
        results.append(record)

        print(
            f"[{row_index}/{len(rows)}] "
            f"{query_path.name} -> "
            f"{record['top1_source']} "
            f"topk={expected_in_topk} "
            f"confirmed={correct_confirmed} "
            f"false_confirmed={false_confirmed}"
        )

    positives = [
        row for row in results
        if row["is_positive"]
    ]
    negatives = [
        row for row in results
        if not row["is_positive"]
    ]

    summary = {
        "library_images": len(index),
        "queries": len(results),
        "positive_queries": len(positives),
        "negative_queries": len(negatives),
        "candidate_topk_recall": (
            sum(bool(row["expected_in_topk"]) for row in positives)
            / max(1, len(positives))
        ),
        "top1_accuracy_positive": (
            sum(bool(row["top1_correct"]) for row in positives)
            / max(1, len(positives))
        ),
        "confirmed_recall_baseline": (
            sum(row["correct_confirmed_baseline"] for row in positives)
            / max(1, len(positives))
        ),
        "false_confirmed_count_baseline": sum(
            row["false_confirmed_baseline"]
            for row in negatives
        ),
        "false_confirmed_rate_baseline": (
            sum(row["false_confirmed_baseline"] for row in negatives)
            / max(1, len(negatives))
        ),
        "query_ms_median": (
            float(np.median([row["query_ms"] for row in results]))
            if results
            else None
        ),
        "query_ms_p95": (
            float(np.percentile([row["query_ms"] for row in results], 95))
            if results
            else None
        ),
        "note": (
            "Real-domain baseline runner. "
            "Candidate layer is selected-region pHash. "
            "Final baseline uses SIFT/RANSAC/NCC. "
            "Thresholds are not production-frozen."
        ),
    }

    Path(args.output).write_text(
        json.dumps(
            {
                "summary": summary,
                "results": results,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print()
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
