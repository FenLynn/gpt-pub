"""Windows-only distribution round-trip and failure isolation checks (stdlib)."""
import ast
import hashlib
import importlib.util
import io
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


runtime = load("restore_audit", ROOT / "tools/restore-package.py")
builder = load("builder_audit", ROOT / "tools/package-camouflage.py")
release = load("release_audit", ROOT / "tools/package-release.py")
checks = []


def check(value, label):
    assert value, label
    checks.append(label)


def inventory(folder):
    return {file.relative_to(folder).as_posix(): file.read_bytes()
            for file in folder.rglob("*") if file.is_file()}


def rejects(call, label):
    try:
        call()
    except (ValueError, PermissionError, RuntimeError):
        checks.append(label)
    else:
        raise AssertionError(label)


def run():
    if sys.platform != "win32":
        print("P109_PACKAGE_AUDIT_SKIP Windows CNG required")
        return
    cipher, tag = runtime.aes_gcm(bytes(16), bytes(16), bytes(12), b"")
    check(cipher.hex() == "0388dace60b6a392f328c2b971b2fe78" and
          tag.hex() == "ab6e47d42cec13bdf53a67b21257bddf", "NIST AES-GCM known vector")
    check(runtime.aes_gcm(cipher, bytes(16), bytes(12), b"", tag)[0] == bytes(16), "known-vector decryption")
    with tempfile.TemporaryDirectory(prefix="p109-package-audit-") as temporary:
        base = Path(temporary)
        source, outer = base / "source.zip", base / "analysis.zip"
        password = "audit-only-中文 20!"
        release.build(ROOT, source)
        receipt = builder.build(source, outer, password)
        check(receipt["sourceSha256"] == hashlib.sha256(source.read_bytes()).hexdigest(), "original package hash")
        with zipfile.ZipFile(outer) as archive:
            check(archive.testzip() is None and all(name.endswith(".py") for name in archive.namelist()), "all wrapper files are Python texts")
            for name in archive.namelist():
                ast.parse(archive.read(name).decode("utf-8"))
            checks.append("all wrapper files parse as Python")

        count = 0

        def fresh():
            nonlocal count
            count += 1
            destination = base / ("中文 解压目录 " + str(count))
            with zipfile.ZipFile(outer) as archive:
                archive.extractall(destination)
            return destination / "analysis_toolkit"

        folder = fresh()
        before = inventory(folder)
        rejects(lambda: runtime.restore(folder, "incorrect-password"), "wrong password rejected")
        check(inventory(folder) == before, "wrong password leaves all files identical")
        chunk = next((folder / "core").glob("*.py"))
        chunk.write_text(chunk.read_text("utf-8").replace("DATA = (", "DATA = ('A'", 1), encoding="utf-8")
        corrupted = inventory(folder)
        rejects(lambda: runtime.restore(folder, password), "tampered chunk rejected")
        check(inventory(folder) == corrupted, "tampering failure performs no writes")

        folder = fresh()
        (folder / "personal.txt").write_text("keep", encoding="utf-8")
        before = inventory(folder)
        rejects(lambda: runtime.restore(folder, password), "unrelated files block overwrite")
        check(inventory(folder) == before, "unrelated files preserved")

        folder = fresh()
        before = inventory(folder)
        original_write = Path.write_bytes

        def deny_stage(at, content):
            if at.name == "index.html":
                raise PermissionError("simulated read-only destination")
            return original_write(at, content)

        with patch.object(Path, "write_bytes", deny_stage):
            rejects(lambda: runtime.restore(folder, password), "staging write failure rejected")
        check(inventory(folder) == before, "staging failure leaves wrapper intact")

        folder = fresh()
        before = inventory(folder)
        original_replace = Path.replace
        failed = False

        def deny_install(at, destination):
            nonlocal failed
            if not failed and str(destination).endswith("00-state.js"):
                failed = True
                raise PermissionError("simulated install interruption")
            return original_replace(at, destination)

        with patch.object(Path, "replace", deny_install):
            rejects(lambda: runtime.restore(folder, password), "install failure rejected")
        check(inventory(folder) == before, "install failure restores exact wrapper")

        folder = fresh()
        before = inventory(folder)
        rejects(lambda: runtime.restore(folder, password, lambda at: (at / "index.html").write_bytes(b"bad")), "read-back corruption rejected")
        check(inventory(folder) == before, "read-back failure rolls back without lost chunks")

        folder = fresh()
        original_unlink = Path.unlink

        def deny_rollback(at, *args, **kwargs):
            if at == folder / "index.html":
                raise PermissionError("simulated rollback denial")
            return original_unlink(at, *args, **kwargs)

        with patch.object(Path, "unlink", deny_rollback):
            rejects(lambda: runtime.restore(folder, password, lambda at: (at / "index.html").write_bytes(b"bad")), "rollback failure reported")
        check(any(folder.glob(".analysis-backup-*/setup.py")), "failed rollback retains backup")

        for name in ["../escape.py", "/absolute.py", "src/../outside.py", "src/trailing. ", "C:/outside.py", "src\\outside.py", "src/CON.py", "src/aux", "src/a?b.py"]:
            rejects(lambda name=name: runtime.safe_relative(name), "unsafe path rejected: " + name)
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("../escape", "bad")
        rejects(lambda: runtime.program_files(data.getvalue()), "ZIP traversal rejected")

        folder = fresh()
        secret = base / "test-password.txt"
        secret.write_text(password, encoding="utf-8")
        proc = subprocess.run([sys.executable, "-I", "-S", str(folder / "lib/init.py"), "--password-file", str(secret)], capture_output=True)
        check(proc.returncode == 0, "actual script works with isolated Python and no site packages: " + proc.stderr.decode(errors="replace"))
        expected = runtime.program_files(source.read_bytes())
        check(inventory(folder) == expected, "all restored runtime bytes exactly match original")
        check(not (folder / "lib/init.py").exists() and not any(folder.glob(".analysis-*")), "success removes self and temporary wrapper")
    print("P109_PACKAGE_AUDIT_PASS " + json.dumps({"checks": len(checks), "items": checks}, ensure_ascii=False))


if __name__ == "__main__":
    run()
