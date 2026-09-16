from __future__ import annotations

import json
import os
import shutil
import time
import uuid
from pathlib import Path


MANIFEST_NAME = "generation.json"
GENERATIONS_DIR = "generations"

BASE_FILES = (
    "region_hashes.npy",
    "image_ids.npy",
    "local_postings.npy",
    "local_offsets.npy",
    "local_idf.npy",
    "local_stop.npy",
)

DELTA_FILES = (
    "local_delta_postings.npy",
    "local_delta_offsets.npy",
    "local_override_ids.npy",
)

ALL_ARRAY_FILES = (
    *BASE_FILES,
    *DELTA_FILES,
)


def _fsync_file(path: Path) -> None:
    with path.open("rb") as handle:
        os.fsync(handle.fileno())


def _fsync_directory(path: Path) -> None:
    try:
        descriptor = os.open(
            path,
            os.O_RDONLY,
        )
    except OSError:
        return

    try:
        os.fsync(descriptor)
    except OSError:
        pass
    finally:
        os.close(descriptor)


def generations_root(index_dir: Path) -> Path:
    root = index_dir / GENERATIONS_DIR
    root.mkdir(
        parents=True,
        exist_ok=True,
    )
    return root


def create_generation(index_dir: Path) -> Path:
    name = (
        f"g-{time.time_ns():020d}-"
        f"{uuid.uuid4().hex[:8]}"
    )
    path = generations_root(
        index_dir
    ) / name
    path.mkdir(
        parents=False,
        exist_ok=False,
    )
    return path


def generation_name(path: Path) -> str:
    return path.name


def resolve_active(
    index_dir: Path,
    meta: dict[str, str],
) -> Path:
    name = meta.get(
        "active_generation",
        "",
    ).strip()

    if not name:
        # Legacy v0.3 and earlier layout.
        return index_dir

    path = generations_root(
        index_dir
    ) / name

    if not generation_complete(
        path
    ):
        raise RuntimeError(
            "Active MediaIndex generation is "
            f"incomplete or missing: {name}"
        )

    return path


def generation_complete(path: Path) -> bool:
    manifest_path = (
        path / MANIFEST_NAME
    )

    if not manifest_path.is_file():
        return False

    try:
        data = json.loads(
            manifest_path.read_text(
                encoding="utf-8"
            )
        )
    except Exception:
        return False

    files = data.get(
        "files",
        [],
    )
    sizes = data.get(
        "sizes",
        {},
    )

    if (
        not isinstance(files, list)
        or not isinstance(sizes, dict)
    ):
        return False

    for name in files:
        filename = str(name)
        target = path / filename

        if not target.is_file():
            return False

        expected = sizes.get(filename)
        if expected is None:
            return False

        try:
            actual = int(
                target.stat().st_size
            )
            expected_size = int(expected)
        except (OSError, TypeError, ValueError):
            return False

        if actual != expected_size:
            return False

    return True


def inherit_files(
    source: Path,
    target: Path,
    filenames,
) -> list[str]:
    inherited = []

    for filename in filenames:
        src = source / filename

        if not src.is_file():
            continue

        dst = target / filename

        try:
            os.link(
                src,
                dst,
            )
        except OSError:
            shutil.copy2(
                src,
                dst,
            )

        inherited.append(
            filename
        )

    return inherited


def write_manifest(
    generation_dir: Path,
    *,
    mode: str,
    files,
    previous_generation: str | None,
) -> dict:
    names = sorted(
        {
            str(name)
            for name in files
            if (
                generation_dir
                / str(name)
            ).is_file()
        }
    )

    required = {
        "region_hashes.npy",
        "image_ids.npy",
        "local_postings.npy",
        "local_offsets.npy",
        "local_idf.npy",
        "local_stop.npy",
    }

    missing = sorted(
        required - set(names)
    )

    if missing:
        raise RuntimeError(
            "Generation missing required files: "
            + ", ".join(missing)
        )

    for name in names:
        _fsync_file(
            generation_dir / name
        )

    payload = {
        "schema": 1,
        "generation": generation_dir.name,
        "created_unix": time.time(),
        "mode": mode,
        "previous_generation": (
            previous_generation
            or None
        ),
        "files": names,
        "sizes": {
            name: int(
                (
                    generation_dir
                    / name
                ).stat().st_size
            )
            for name in names
        },
    }

    target = (
        generation_dir
        / MANIFEST_NAME
    )
    temp = (
        generation_dir
        / (
            MANIFEST_NAME
            + ".tmp"
        )
    )

    with temp.open(
        "w",
        encoding="utf-8",
        newline="
",
    ) as handle:
        json.dump(
            payload,
            handle,
            ensure_ascii=False,
            indent=2,
        )
        handle.flush()
        os.fsync(
            handle.fileno()
        )

    os.replace(
        temp,
        target,
    )
    _fsync_directory(
        generation_dir
    )

    # Re-open after replace. A generation is only eligible
    # for the SQLite pointer after this validation succeeds.
    if not generation_complete(
        generation_dir
    ):
        raise RuntimeError(
            "Generation manifest validation failed"
        )

    return payload


def remove_generation(
    generation_dir: Path,
) -> None:
    try:
        shutil.rmtree(
            generation_dir,
        )
    except OSError:
        # Windows will refuse removal while another process
        # still has mmap handles. Leaving an old immutable
        # generation is safe and preferable to forcing it.
        pass


def cleanup(
    index_dir: Path,
    *,
    active_generation: str,
    keep: int = 3,
) -> None:
    root = generations_root(
        index_dir
    )

    candidates = [
        path
        for path in root.iterdir()
        if path.is_dir()
        and generation_complete(path)
    ]

    candidates.sort(
        key=lambda path: (
            path.stat().st_mtime_ns,
            path.name,
        ),
        reverse=True,
    )

    keep_names = {
        active_generation,
    }

    for path in candidates:
        if len(keep_names) >= max(
            1,
            keep,
        ):
            break
        keep_names.add(
            path.name
        )

    for path in candidates:
        if path.name in keep_names:
            continue
        remove_generation(
            path
        )


def cleanup_incomplete(
    index_dir: Path,
) -> None:
    root = generations_root(
        index_dir
    )

    for path in root.iterdir():
        if not path.is_dir():
            continue

        if generation_complete(
            path
        ):
            continue

        remove_generation(
            path
        )
