"""Ordinary ZIP publication and distribution failure isolation checks."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile
from unittest.mock import patch
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
release = load("release_audit", ROOT / "tools/package-release.py")
checks = []
def check(value, label):
    assert value, label
    checks.append(label)
def run():
    with tempfile.TemporaryDirectory(prefix="p109-publication-audit-") as temporary:
        base = Path(temporary)
        source = base / "private.zip"
        with zipfile.ZipFile(source, "x", compression=zipfile.ZIP_STORED) as archive:
            archive.writestr("中文 目录/index.html", "offline")
        source.chmod(0o600)
        original = source.read_bytes()
        destination = base / "交付 包.zip"
        receipt = release.publish(source, destination)
        check(destination.read_bytes() == original and receipt["sha256"] == hashlib.sha256(original).hexdigest(), "publication preserves every archive byte")
        check(source.read_bytes() == original, "publication leaves source intact")
        control = base / "normal-file"
        control.write_bytes(b"control")
        check(destination.stat().st_mode == control.stat().st_mode, "publication uses destination default permissions")
        try:
            release.publish(source, destination)
        except FileExistsError:
            checks.append("publication refuses existing destination")
        else:
            raise AssertionError("existing delivery overwritten")
        check(destination.read_bytes() == original, "refused overwrite preserves delivery")
        damaged = base / "damaged.zip"
        damaged.write_bytes(original[:-22])
        rejected = base / "rejected.zip"
        try:
            release.publish(damaged, rejected)
        except zipfile.BadZipFile:
            checks.append("invalid ZIP rejected before publication")
        else:
            raise AssertionError("invalid ZIP published")
        check(not rejected.exists(), "invalid ZIP leaves no output")
        with patch.object(release.os, "fsync", side_effect=OSError("test")):
            try:
                release.publish(source, rejected)
            except OSError:
                checks.append("publication write failure reported")
            else:
                raise AssertionError("write failure ignored")
        check(not rejected.exists() and source.read_bytes() == original, "publication removes partial output only")
        proc = subprocess.run([sys.executable, "-I", "-S", str(ROOT / "tools/package-release.py"), "--publish", str(source), str(rejected)], capture_output=True)
        check(proc.returncode == 0 and rejected.read_bytes() == original and json.loads(proc.stdout)["sha256"] == receipt["sha256"], "publication CLI supports Unicode and spaces without dependencies")
    with tempfile.TemporaryDirectory(prefix="p109-release-audit-") as temporary:
        source = Path(temporary) / "P109-升级包-测试.zip"
        release.build(ROOT, source)
        with zipfile.ZipFile(source) as archive:
            manifest = json.loads(archive.read("p109-release-manifest.json"))
            paths = [row["path"] for row in manifest["files"]]
            check(archive.testzip() is None, "ordinary release ZIP passes CRC verification")
            check(paths[:2] == ["index.html", "README.md"] and paths[2:] == sorted(paths[2:]), "program manifest uses deterministic path ordering")
            check(all(archive.getinfo(name).compress_type == zipfile.ZIP_STORED for name in archive.namelist()), "ordinary release uses Windows-compatible stored entries")
            for row in manifest["files"]:
                data = archive.read(row["path"])
                check(len(data) == row["bytes"] and hashlib.sha256(data).hexdigest() == row["sha256"], "manifest verifies " + row["path"])
    print("P109_PACKAGE_AUDIT_PASS " + json.dumps({"checks": len(checks), "items": checks}, ensure_ascii=False))
if __name__ == "__main__":
    run()
