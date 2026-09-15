from __future__ import annotations

import time
import warnings

import cv2
import numpy as np
from skimage import data


IMAGE_NAMES = [
    "astronaut",
    "camera",
    "brick",
    "cell",
    "chelsea",
    "clock",
    "coffee",
    "coins",
    "grass",
    "gravel",
    "horse",
    "hubble_deep_field",
    "immunohistochemistry",
    "moon",
    "page",
    "retina",
    "rocket",
    "text",
    "colorwheel",
    "logo",
]

THUMB_SIZES = [192, 256, 320, 384]


def to_bgr(image: np.ndarray) -> np.ndarray:
    image = np.asarray(image)
    if image.ndim == 2:
        return cv2.cvtColor(image.astype(np.uint8), cv2.COLOR_GRAY2BGR)
    if image.shape[2] > 3:
        image = image[:, :, :3]
    return cv2.cvtColor(image.astype(np.uint8), cv2.COLOR_RGB2BGR)


def resize_max(image: np.ndarray, max_dim: int = 768) -> np.ndarray:
    height, width = image.shape[:2]
    scale = min(1.0, max_dim / max(height, width))
    if scale >= 1.0:
        return image
    return cv2.resize(
        image,
        (max(1, int(width * scale)), max(1, int(height * scale))),
        interpolation=cv2.INTER_AREA,
    )


def gray(image: np.ndarray) -> np.ndarray:
    if image.ndim == 2:
        return image
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def jpeg(image: np.ndarray, quality: int) -> np.ndarray:
    ok, encoded = cv2.imencode(
        ".jpg",
        image,
        [int(cv2.IMWRITE_JPEG_QUALITY), quality],
    )
    if not ok:
        raise RuntimeError("JPEG encode failed")
    return cv2.imdecode(encoded, cv2.IMREAD_COLOR)


def crop_center(image: np.ndarray, keep: float) -> np.ndarray:
    height, width = image.shape[:2]
    crop_w = max(16, int(width * keep))
    crop_h = max(16, int(height * keep))
    x = (width - crop_w) // 2
    y = (height - crop_h) // 2
    return image[y : y + crop_h, x : x + crop_w].copy()


def crop_asymmetric(image: np.ndarray, keep: float) -> np.ndarray:
    height, width = image.shape[:2]
    crop_w = max(16, int(width * keep))
    crop_h = max(16, int(height * keep))
    x = min(width - crop_w, int(width * 0.42))
    y = min(height - crop_h, int(height * 0.12))
    return image[y : y + crop_h, x : x + crop_w].copy()


def watermark(image: np.ndarray) -> np.ndarray:
    out = image.copy()
    height, width = out.shape[:2]
    scale = max(0.5, min(height, width) / 300)
    thickness = max(1, int(min(height, width) * 0.01))
    text = "MEDIA"
    (text_w, text_h), _ = cv2.getTextSize(
        text,
        cv2.FONT_HERSHEY_SIMPLEX,
        scale,
        thickness,
    )
    x = max(0, width - text_w - 10)
    y = max(text_h + 5, height - 10)
    overlay = out.copy()
    cv2.rectangle(
        overlay,
        (max(0, x - 5), max(0, y - text_h - 5)),
        (min(width - 1, x + text_w + 5), min(height - 1, y + 5)),
        (0, 0, 0),
        -1,
    )
    out = cv2.addWeighted(overlay, 0.35, out, 0.65, 0)
    cv2.putText(
        out,
        text,
        (x, y),
        cv2.FONT_HERSHEY_SIMPLEX,
        scale,
        (255, 255, 255),
        thickness,
        cv2.LINE_AA,
    )
    return out


def rotate(image: np.ndarray, degrees: float) -> np.ndarray:
    height, width = image.shape[:2]
    matrix = cv2.getRotationMatrix2D(
        (width / 2, height / 2),
        degrees,
        1.0,
    )
    return cv2.warpAffine(
        image,
        matrix,
        (width, height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT,
    )


def perspective(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    delta = min(height, width) * 0.06
    source = np.float32(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]]
    )
    target = np.float32(
        [
            [delta, 0],
            [width - 1 - delta, delta],
            [width - 1, height - 1],
            [0, height - 1 - delta],
        ]
    )
    matrix = cv2.getPerspectiveTransform(source, target)
    return cv2.warpPerspective(
        image,
        matrix,
        (width, height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT,
    )


def combo(image: np.ndarray) -> np.ndarray:
    out = crop_asymmetric(image, 0.5)
    height, width = out.shape[:2]
    out = cv2.resize(
        out,
        (max(32, int(width * 0.6)), max(32, int(height * 0.6))),
        interpolation=cv2.INTER_AREA,
    )
    out = watermark(out)
    return jpeg(out, 25)


TRANSFORMS = {
    "jpeg20": lambda image: jpeg(image, 20),
    "crop30": lambda image: crop_center(image, 0.7),
    "crop50": lambda image: crop_center(image, 0.5),
    "crop70": lambda image: crop_center(image, 0.3),
    "asym50": lambda image: crop_asymmetric(image, 0.5),
    "watermark": watermark,
    "rotate5": lambda image: rotate(image, 5),
    "perspective": perspective,
    "combo": combo,
    "mirror": lambda image: cv2.flip(image, 1),
}


def make_thumbnail(
    image: np.ndarray,
    max_dim: int,
    quality: int = 60,
) -> tuple[np.ndarray, int]:
    source = gray(image)
    height, width = source.shape
    scale = min(1.0, max_dim / max(height, width))
    if scale < 1.0:
        source = cv2.resize(
            source,
            (max(1, int(width * scale)), max(1, int(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    ok, encoded = cv2.imencode(
        ".jpg",
        source,
        [int(cv2.IMWRITE_JPEG_QUALITY), quality],
    )
    if not ok:
        raise RuntimeError("thumbnail encode failed")
    decoded = cv2.imdecode(encoded, cv2.IMREAD_GRAYSCALE)
    return decoded, int(encoded.size)


def coverage(points: np.ndarray, width: int, height: int) -> float:
    if len(points) < 3:
        return 0.0
    hull = cv2.convexHull(
        np.asarray(points, dtype=np.float32).reshape(-1, 1, 2)
    )
    return float(abs(cv2.contourArea(hull)) / max(1, width * height))


def ncc_after_warp(
    query_gray: np.ndarray,
    library_gray: np.ndarray,
    homography: np.ndarray,
) -> float:
    height, width = library_gray.shape
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
    a = warped[mask].astype(np.float32)
    b = library_gray[mask].astype(np.float32)
    if a.size < 100 or a.std() < 1e-6 or b.std() < 1e-6:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])


def extract_sift(
    detector: cv2.SIFT,
    image: np.ndarray,
) -> tuple[np.ndarray, list[cv2.KeyPoint], np.ndarray | None]:
    source = gray(image)
    keypoints, descriptors = detector.detectAndCompute(source, None)
    return source, keypoints, descriptors


def match(
    matcher: cv2.BFMatcher,
    query_feature,
    library_feature,
) -> dict:
    q_gray, q_keypoints, q_descriptors = query_feature
    l_gray, l_keypoints, l_descriptors = library_feature

    empty = {
        "inliers": 0,
        "ratio": 0.0,
        "qfrac": 0.0,
        "qcov": 0.0,
        "ncc": 0.0,
    }

    if (
        q_descriptors is None
        or l_descriptors is None
        or len(q_descriptors) < 2
        or len(l_descriptors) < 2
    ):
        return empty

    pairs = matcher.knnMatch(q_descriptors, l_descriptors, k=2)
    good = []
    for pair in pairs:
        if len(pair) >= 2 and pair[0].distance < 0.75 * pair[1].distance:
            good.append(pair[0])

    if len(good) < 4:
        return empty

    source = np.float32(
        [q_keypoints[item.queryIdx].pt for item in good]
    ).reshape(-1, 1, 2)
    target = np.float32(
        [l_keypoints[item.trainIdx].pt for item in good]
    ).reshape(-1, 1, 2)

    homography, mask = cv2.findHomography(
        source,
        target,
        cv2.RANSAC,
        4.0,
    )
    if homography is None or mask is None:
        return empty

    inlier_mask = mask.ravel().astype(bool)
    inliers = int(inlier_mask.sum())
    q_points = source.reshape(-1, 2)[inlier_mask]

    return {
        "inliers": inliers,
        "ratio": inliers / max(1, len(good)),
        "qfrac": inliers / max(1, len(q_keypoints)),
        "qcov": coverage(
            q_points,
            q_gray.shape[1],
            q_gray.shape[0],
        ),
        "ncc": ncc_after_warp(q_gray, l_gray, homography),
    }


def high_confidence(metrics: dict, ncc_threshold: float) -> bool:
    return (
        metrics["inliers"] >= 8
        and metrics["ratio"] >= 0.75
        and metrics["qcov"] >= 0.03
        and metrics["ncc"] >= ncc_threshold
    )


def main() -> None:
    detector = cv2.SIFT_create(
        nfeatures=1800,
        contrastThreshold=0.02,
        edgeThreshold=10,
        sigma=1.6,
    )
    matcher = cv2.BFMatcher(cv2.NORM_L2)

    library = {}
    for name in IMAGE_NAMES:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                image = getattr(data, name)()
            library[name] = resize_max(to_bgr(image))
        except Exception:
            pass

    print(f"library_images={len(library)}")
    if len(library) < 8:
        raise RuntimeError("Too few skimage sample images are available")

    query_rows = []
    for name, image in library.items():
        for transform_name, transform in TRANSFORMS.items():
            query_rows.append(
                (
                    name,
                    transform_name,
                    transform(image),
                )
            )

    query_features = {}
    for name, transform_name, image in query_rows:
        query_features[(name, transform_name)] = extract_sift(
            detector,
            image,
        )

    for max_dim in THUMB_SIZES:
        thumbnail_features = {}
        thumbnail_bytes = []
        extraction_ms = []

        for name, image in library.items():
            thumb, encoded_bytes = make_thumbnail(
                image,
                max_dim,
                quality=60,
            )
            thumbnail_bytes.append(encoded_bytes)

            start = time.perf_counter()
            keypoints, descriptors = detector.detectAndCompute(
                thumb,
                None,
            )
            extraction_ms.append(
                (time.perf_counter() - start) * 1000
            )
            thumbnail_features[name] = (
                thumb,
                keypoints,
                descriptors,
            )

        true_metrics = []
        for name, transform_name, image in query_rows:
            query_feature = query_features[(name, transform_name)]
            result = match(
                matcher,
                query_feature,
                thumbnail_features[name],
            )

            if transform_name == "mirror":
                flipped = cv2.flip(image, 1)
                mirror_result = match(
                    matcher,
                    extract_sift(detector, flipped),
                    thumbnail_features[name],
                )
                if (
                    mirror_result["ncc"],
                    mirror_result["inliers"],
                ) > (
                    result["ncc"],
                    result["inliers"],
                ):
                    result = mirror_result

            true_metrics.append(result)

        negative_metrics = []
        names = list(library)
        full_features = {
            name: extract_sift(detector, image)
            for name, image in library.items()
        }
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                negative_metrics.append(
                    match(
                        matcher,
                        full_features[names[i]],
                        thumbnail_features[names[j]],
                    )
                )

        try:
            left, right, _ = data.stereo_motorcycle()
            left = resize_max(to_bgr(left))
            right = resize_max(to_bgr(right))
            right_thumb, _ = make_thumbnail(
                right,
                max_dim,
                quality=60,
            )
            right_feature = extract_sift(detector, right_thumb)
            for stereo_query in (
                left,
                crop_center(left, 0.5),
                crop_asymmetric(left, 0.5),
                crop_center(left, 0.3),
            ):
                negative_metrics.append(
                    match(
                        matcher,
                        extract_sift(detector, stereo_query),
                        right_feature,
                    )
                )
        except Exception:
            pass

        if max_dim == 192:
            ncc_threshold = 0.85
        elif max_dim == 256:
            ncc_threshold = 0.90
        elif max_dim == 320:
            ncc_threshold = 0.90
        else:
            ncc_threshold = 0.88

        true_confirmed = sum(
            high_confidence(item, ncc_threshold)
            for item in true_metrics
        )
        false_positive = sum(
            high_confidence(item, ncc_threshold)
            for item in negative_metrics
        )

        average_bytes = float(np.mean(thumbnail_bytes))
        estimated_gib = average_bytes * 500_000 / 1024**3

        print()
        print(f"max_dim={max_dim}")
        print(f"average_jpeg_bytes={average_bytes:.1f}")
        print(f"estimated_500k_gib={estimated_gib:.3f}")
        print(
            "sift_extract_ms="
            f"median:{np.median(extraction_ms):.3f},"
            f"p95:{np.percentile(extraction_ms, 95):.3f}"
        )
        print(
            f"true_confirmed={true_confirmed}/{len(true_metrics)}"
        )
        print(
            "cross_image_false_positive="
            f"{false_positive}/{len(negative_metrics)}"
        )


if __name__ == "__main__":
    main()
