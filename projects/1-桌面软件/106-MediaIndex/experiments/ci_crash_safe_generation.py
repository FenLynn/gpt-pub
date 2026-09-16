"""Regression checks for crash-safe generation switching.

This intentionally simulates the important failure boundary: a new generation
exists but CURRENT.json must still point to the last complete generation until
activation succeeds.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from crash_safe_generation import CrashSafeGenerationStore



def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        store = CrashSafeGenerationStore(tmp)

        first = store.begin("g001")
        (first / "index.sqlite3").write_text("ok", encoding="utf-8")
        store.activate("g001", "test", ["index.sqlite3"])
        assert store.current().generation_id == "g001"

        second = store.begin("g002")
        (second / "index.sqlite3").write_text("partial", encoding="utf-8")
        try:
            store.activate("g002", "test", ["index.sqlite3", "postings.npy"])
        except RuntimeError:
            pass
        else:
            raise AssertionError("partial generation activated")

        assert store.current().generation_id == "g001"

        (second / "postings.npy").write_text("ok", encoding="utf-8")
        store.activate("g002", "test", ["index.sqlite3", "postings.npy"])
        assert store.current().generation_id == "g002"


if __name__ == "__main__":
    main()
