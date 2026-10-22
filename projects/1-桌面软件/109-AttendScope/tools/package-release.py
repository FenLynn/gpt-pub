#!/usr/bin/env python3
"""Build a clean offline P109 package from source; never include user/project data.

Usage: python tools/package-release.py PATH_TO_P109 OUTPUT.zip
This builder is for development/CI only. Extracted runtime needs no Python.
"""
import hashlib
import json
import pathlib
import sys
import zipfile

APP_VERSION = "0.2.2-preview"
PROJECT = "P109-AttendScope"

def build(root: pathlib.Path, destination: pathlib.Path):
    sources = [root / "index.html", root / "README.md"] + sorted(
        f for f in (root / "src").rglob("*") if f.is_file()
    )
    allowed = []
    for item in sources:
        rel = item.relative_to(root).as_posix()
        if not (rel in ("index.html", "README.md") or rel.startswith("src/")):
            raise ValueError("Out of scope asset: " + rel)
        allowed.append((rel, item.read_bytes()))
    manifest = {
        "schemaVersion": 1,
        "projectId": PROJECT,
        "appVersion": APP_VERSION,
        "supportedDataSchemas": [2],
        "files": [
            {"path": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
            for name, data in allowed
        ],
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_STORED, allowZip64=False) as output:
        for name, data in allowed:
            output.writestr(name, data, compress_type=zipfile.ZIP_STORED)
        output.writestr("p109-release-manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
    with zipfile.ZipFile(destination, "r") as verification:
        if verification.testzip():
            raise RuntimeError("ZIP CRC verification failed")
    print(json.dumps({"output": str(destination), "files": len(allowed), "version": APP_VERSION}))

if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: package-release.py P109_ROOT OUTPUT.zip")
    build(pathlib.Path(sys.argv[1]).resolve(), pathlib.Path(sys.argv[2]).resolve())
