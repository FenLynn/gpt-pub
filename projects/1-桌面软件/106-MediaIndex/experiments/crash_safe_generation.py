"""Crash-safe generation primitives for MediaIndex persistent indexes.

The production rule is:

1. Never mutate the currently active generation.
2. Build a complete new generation in a private directory.
3. Validate required files and metadata.
4. Atomically switch the small manifest pointer.
5. Garbage collection happens only after a successful switch.

This module is intentionally storage-agnostic. The application layer can use it
for image Lane A, Lane B, and future video generations.
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


MANIFEST_NAME = "CURRENT.json"


@dataclass(frozen=True)
class GenerationManifest:
    generation_id: str
    created_at: str
    files: tuple[str, ...]
    schema_version: int = 1


class CrashSafeGenerationStore:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.generations = self.root / "generations"
        self.manifest = self.root / MANIFEST_NAME

    def begin(self, generation_id: str) -> Path:
        path = self.generations / generation_id
        path.mkdir(parents=True, exist_ok=False)
        return path

    def write_manifest_atomic(self, value: GenerationManifest) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(asdict(value), indent=2, sort_keys=True)
        fd, name = tempfile.mkstemp(prefix="CURRENT.", suffix=".tmp", dir=self.root)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(name, self.manifest)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def activate(self, generation_id: str, created_at: str, required: Iterable[str]) -> None:
        generation = self.generations / generation_id
        required = tuple(required)
        missing = [x for x in required if not (generation / x).exists()]
        if missing:
            raise RuntimeError(f"incomplete generation: {missing}")
        self.write_manifest_atomic(
            GenerationManifest(
                generation_id=generation_id,
                created_at=created_at,
                files=required,
            )
        )

    def current(self) -> GenerationManifest | None:
        if not self.manifest.exists():
            return None
        data = json.loads(self.manifest.read_text(encoding="utf-8"))
        return GenerationManifest(
            generation_id=data["generation_id"],
            created_at=data["created_at"],
            files=tuple(data["files"]),
            schema_version=data.get("schema_version", 1),
        )
