"""ZIP publication and Windows distribution failure isolation checks."""
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
    return {file.relative_to(folder).as_posix(): file.read_bytes() for file in folder.rglob("*") if file.is_file()}
def rejects(call, label):
    try:
        call()
    except (ValueError, PermissionError, RuntimeError):
        checks.append(label)
    else:
        raise AssertionError(label)
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
    if sys.platform != "win32":
        print("P109_PACKAGE_AUDIT_PASS " + json.dumps({"checks": len(checks), "items": checks, "windowsCng": "not available"}))
        return
    cipher, tag = runtime.aes_gcm(bytes(16), bytes(16), bytes(12), b"")
    check(cipher.hex() == "0388dace60b6a392f328c2b971b2fe78" and tag.hex() == "ab6e47d42cec13bdf53a67b21257bddf", "NIST AES-GCM known vector")
    check(runtime.aes_gcm(cipher, bytes(16), bytes(12), b"", tag)[0] == bytes(16), "known-vector decryption")
    with tempfile.TemporaryDirectory(prefix="p109-package-audit-") as temporary:
        base = Path(temporary)
        source, outer = base / "P109-升级包-测试.zip", base / "analysis.zip"
        password = "audit-only-test-input"
        release.build(ROOT, source)
        with zipfile.ZipFile(source) as archive:
            paths = json.loads(archive.read('p109-release-manifest.json'))['files']
            paths = [row['path'] for row in paths if row['path'].startswith('src/')]
            check(paths == sorted(paths), 'program manifest uses platform-independent path ordering')
        receipt = builder.build(source, outer, password)
        check(receipt["sourceSha256"] == hashlib.sha256(source.read_bytes()).hexdigest(), "original package hash")
        with zipfile.ZipFile(outer) as archive:
            check(archive.testzip() is None and all(name.endswith(".py") for name in archive.namelist()), "wrapper contains Python texts only")
            for name in archive.namelist():
                text = archive.read(name).decode("ascii")
                ast.parse(text)
            checks.append("wrapper is ASCII and valid Python")
            init = archive.read("analysis_toolkit/lib/init.py").decode("ascii")
            check(not any(isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str) for n in ast.walk(ast.parse(init))) and not any(line.lstrip().startswith("#") for line in init.splitlines()), "init has no comments or docstrings")
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
        check(inventory(folder) == before, "wrong password performs no writes")
        proc = subprocess.run([sys.executable, "-I", "-S", str(folder / "lib/init.py")], input=b"wrong\n", capture_output=True)
        check(proc.returncode == 1 and proc.stdout.strip() == b"please input:" and proc.stderr.strip() == b"error input", "real CLI failure is generic without traceback")
        chunk = next((folder / "core").glob("*.py"))
        chunk.write_text(chunk.read_text("utf-8").replace("DATA = (", "DATA = ('A'", 1), encoding="utf-8")
        corrupted = inventory(folder)
        rejects(lambda: runtime.restore(folder, password), "tampered chunk rejected")
        check(inventory(folder) == corrupted, "tamper rejection preserves wrapper")
        folder = fresh()
        (folder / "personal.txt").write_text("keep", encoding="utf-8")
        before = inventory(folder)
        rejects(lambda: runtime.restore(folder, password), "unrelated files block output")
        check(inventory(folder) == before, "unrelated files remain intact")
        folder = fresh()
        before = inventory(folder)
        with patch.object(runtime.tempfile, "NamedTemporaryFile", side_effect=PermissionError("test")):
            rejects(lambda: runtime.restore(folder, password), "read-only directory rejected")
        check(inventory(folder) == before, "staging failure leaves original intact")
        with patch.object(Path, "rename", side_effect=PermissionError("test")):
            rejects(lambda: runtime.restore(folder, password), "output rename failure rejected")
        check(inventory(folder) == before, "rename failure removes staging only")
        rejects(lambda: runtime.restore(folder, password, lambda at: at.write_bytes(b"bad")), "staging corruption rejected")
        check(inventory(folder) == before, "corruption leaves no partial ZIP")
        output = folder / source.name
        output.write_bytes(b"existing")
        rejects(lambda: runtime.restore(folder, password), "conflicting ZIP rejected")
        check(output.read_bytes() == b"existing", "conflicting ZIP never overwritten")
        output.unlink()
        original_read = Path.read_bytes
        def bad_read(at):
            return b"bad" if at == output else original_read(at)
        with patch.object(Path, "read_bytes", bad_read):
            rejects(lambda: runtime.restore(folder, password), "post-install corruption rejected")
        check(inventory(folder) == before, "failed output removed and wrapper preserved")
        for name in ["../escape.py", "/absolute.py", "src/../outside.py", "src/trailing. ", "C:/outside.py", "src\\outside.py", "src/CON.py", "src/aux", "src/a?b.py"]:
            rejects(lambda name=name: runtime.safe_relative(name), "unsafe path rejected: " + name)
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("../escape", "bad")
        rejects(lambda: runtime.program_files(data.getvalue()), "ZIP traversal rejected")
        folder = fresh()
        before = inventory(folder)
        proc = subprocess.run([sys.executable, "-I", "-S", str(folder / "lib/init.py")], input=(password + "\n").encode(), capture_output=True)
        check(proc.returncode == 0 and proc.stdout.strip() == b"please input: done" and not proc.stderr, "isolated Python CLI emits minimal success")
        output = folder / source.name
        check(output.read_bytes() == source.read_bytes(), "output ZIP bytes and filename match source exactly")
        check({k: v for k, v in inventory(folder).items() if k != source.name} == before, "original wrapper and script retained unchanged")
        check(runtime.program_files(output.read_bytes()) == runtime.program_files(source.read_bytes()), "output remains a verified program upgrade")
        before = inventory(folder)
        runtime.restore(folder, password)
        check(inventory(folder) == before, "repeated recovery is idempotent")
    print("P109_PACKAGE_AUDIT_PASS " + json.dumps({"checks": len(checks), "items": checks}, ensure_ascii=False))
if __name__ == "__main__":
    run()
