#!/usr/bin/env python3
"""Build a clean offline P109 package from source; never include user/project data.

Usage: python tools/package-release.py PATH_TO_P109 OUTPUT.zip
       python tools/package-release.py --publish STAGED.zip OUTPUT.zip
This builder is for development/CI only. Extracted runtime needs no Python.
"""
import hashlib
import json
import os
import pathlib
import re
import sys
import zipfile

PROJECT = "P109-AttendScope"

def publish(source: pathlib.Path, destination: pathlib.Path):
    """Copy validated bytes into a new file inheriting its destination's ACL.

    A same-volume rename preserves a private staging file's Windows DACL.
    Never rename/copy metadata from staging into a user-facing delivery.
    Existing destinations, including symbolic links, are not overwritten.
    """
    source = source.resolve(strict=True)
    destination = destination.parent.resolve(strict=True) / destination.name
    created = False
    try:
        with source.open("rb") as incoming:
            with zipfile.ZipFile(incoming) as archive:
                if archive.testzip():
                    raise ValueError("Source ZIP CRC verification failed")
            incoming.seek(0)
            digest = hashlib.sha256()
            with destination.open("xb") as outgoing:
                created = True
                while chunk := incoming.read(1024 * 1024):
                    outgoing.write(chunk)
                    digest.update(chunk)
                outgoing.flush()
                os.fsync(outgoing.fileno())
        delivered = hashlib.sha256(destination.read_bytes()).hexdigest()
        if delivered != digest.hexdigest():
            raise RuntimeError("Published ZIP hash verification failed")
        with zipfile.ZipFile(destination) as archive:
            if archive.testzip():
                raise RuntimeError("Published ZIP CRC verification failed")
    except BaseException:
        if created:
            destination.unlink()
        raise
    return {"output": str(destination), "sha256": delivered, "bytes": destination.stat().st_size}

def build(root: pathlib.Path, destination: pathlib.Path):
    version_source = (root / "src/app/00-state.js").read_text(encoding="utf-8")
    match = re.search(r"const P109_APP_VERSION='([^']+)';", version_source)
    if not match:
        raise ValueError("Missing application version")
    app_version = match.group(1)
    revision = re.search(r"const P109_APP_REVISION='([^']+)';", version_source)[1]
    data_schema = int(re.search(r"const P109_DATA_SCHEMA=(\d+);", version_source)[1])
    sources = [root / "index.html", root / "README.md"] + sorted(
        (f for f in (root / "src").rglob("*") if f.is_file()),
        key=lambda f: f.relative_to(root).as_posix(),
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
        "appVersion": app_version,
        "appRevision": revision,
        "updateFormat": 1,
        "minimumUpdaterVersion": "0.2.3-preview",
        "supportedDataSchemas": list(range(2, data_schema + 1)),
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
    print(json.dumps({"output": str(destination), "files": len(allowed), "version": app_version}))

if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--publish":
        print(json.dumps(publish(pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3]))))
        sys.exit(0)
    if len(sys.argv) != 3:
        sys.exit("Usage: package-release.py P109_ROOT OUTPUT.zip | --publish STAGED.zip OUTPUT.zip")
    build(pathlib.Path(sys.argv[1]).resolve(), pathlib.Path(sys.argv[2]).resolve())
