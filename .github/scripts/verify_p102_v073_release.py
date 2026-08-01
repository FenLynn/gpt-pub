from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import urllib.request
import zipfile
from pathlib import Path

REPOSITORY = "FenLynn/gpt-pub"
TARGET = "df66c9246706439c35f082027a82eb34e827de69"
TESTED = "885eaa320b9db6efcfb7665631b2650348e368ad"
ARTIFACT_ID = 8817462686
ARTIFACT_SHA256 = "1f2564f6429595a049140b684d5b8e4d301c5e47ca273259cac576063230bda3"
PORTABLE_SHA256 = "cf6fdf10b0806b1d81806b1c036323785f6622bc4f7afd57789ff9a199890720"
EXE_SHA256 = "78a034923a6d522fb0d2e0c3e2f701dd9ad0be30e21dd33f4edb0c14605825ff"
ROOT = Path("/tmp/p102-release")
OUTER = ROOT / "outer"
FILES = ROOT / "files"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(*args: str, capture: bool = False) -> str:
    result = subprocess.run(
        list(args),
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
    )
    return result.stdout if capture else ""


def verify_source_equivalence() -> None:
    run("git", "cat-file", "-e", f"{TARGET}^{{commit}}")
    run("git", "cat-file", "-e", f"{TESTED}^{{commit}}")
    changed = run(
        "git",
        "-c",
        "core.quotePath=false",
        "diff",
        "--name-only",
        TESTED,
        TARGET,
        "--",
        "projects/1-桌面软件/102-AtlasDesk/**",
        ".github/workflows/p102-atlasdesk-ci.yml",
        capture=True,
    ).strip()
    if changed:
        raise RuntimeError(f"Tested and release source differ:\n{changed}")
    version = run(
        "git",
        "show",
        f"{TARGET}:projects/1-桌面软件/102-AtlasDesk/代码/personal-workbench-native/Version.props",
        capture=True,
    )
    if "<WorkbenchVersion>0.7.3</WorkbenchVersion>" not in version:
        raise RuntimeError("Release target does not contain AtlasDesk v0.7.3")


def download_artifact() -> Path:
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        raise RuntimeError("GITHUB_TOKEN is missing")
    archive = ROOT / "artifact.zip"
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPOSITORY}/actions/artifacts/{ARTIFACT_ID}/zip",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "P102-AtlasDesk-Release-Verifier",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response, archive.open("wb") as output:
        shutil.copyfileobj(response, output)
    if sha256(archive) != ARTIFACT_SHA256:
        raise RuntimeError("Actions Artifact SHA-256 mismatch")
    return archive


def read_normalized_lines(path: Path) -> list[str]:
    text = path.read_bytes().decode("utf-8-sig")
    return [line.rstrip("\r") for line in text.splitlines()]


def verify_assets(archive: Path) -> dict[str, object]:
    shutil.rmtree(OUTER, ignore_errors=True)
    shutil.rmtree(FILES, ignore_errors=True)
    OUTER.mkdir(parents=True)
    FILES.mkdir(parents=True)
    with zipfile.ZipFile(archive) as bundle:
        bundle.extractall(OUTER)

    portable = OUTER / "AtlasDesk_v0.7.3_Lightweight.zip"
    exe = OUTER / "AtlasDesk_v0.7.3_Lightweight" / "AtlasDesk.exe"
    checksum = OUTER / "SHA256.txt"
    manifest = OUTER / "build-manifest.txt"
    for path in (portable, exe, checksum, manifest):
        if not path.is_file():
            raise RuntimeError(f"Missing release asset: {path.name}")

    if sha256(portable) != PORTABLE_SHA256:
        raise RuntimeError("Portable ZIP SHA-256 mismatch")
    if sha256(exe) != EXE_SHA256:
        raise RuntimeError("AtlasDesk.exe SHA-256 mismatch")

    checksum_lines = read_normalized_lines(checksum)
    expected_checksum = f"{EXE_SHA256}  AtlasDesk.exe"
    if expected_checksum not in checksum_lines:
        raise RuntimeError("SHA256.txt does not contain the verified AtlasDesk.exe hash")

    required_manifest = {
        "product=AtlasDesk",
        "project=P102",
        "repository=FenLynn/gpt-pub",
        "version=0.7.3",
        "compatibility_identity=PersonalWorkbench",
        "source_commit=c48180a2ac74b6336220bce484c8051551d4e2fb",
        "public_filtered_head=f8493a0bcb73ed0e05f039144890dc07b5d885fb",
        "app_payload_bytes=5073349",
        "terminal_host_bytes=176640",
        "final_exe_bytes=11488256",
        "smoke_tests=passed",
        "self_contained=false",
        "bundled_dotnet_runtime=false",
        "bundled_webview2_runtime=false",
        "bundled_node_runtime=false",
        "bundled_python=false",
        "bundled_conda=false",
        "bundled_uv=false",
        "bundled_pdf_engine=false",
        "terminal_renderer=xterm.js_6.0.0",
        "terminal_backend=native_gui_bridge_windows_system_conpty",
    }
    manifest_lines = set(read_normalized_lines(manifest))
    missing = sorted(required_manifest - manifest_lines)
    if missing:
        raise RuntimeError("Manifest entries missing: " + ", ".join(missing))

    portable_dir = ROOT / "portable"
    shutil.rmtree(portable_dir, ignore_errors=True)
    portable_dir.mkdir()
    with zipfile.ZipFile(portable) as package:
        package.extractall(portable_dir)
    inner_exe = portable_dir / "AtlasDesk.exe"
    if not inner_exe.is_file() or sha256(inner_exe) != EXE_SHA256:
        raise RuntimeError("Portable ZIP AtlasDesk.exe hash mismatch")
    if exe.read_bytes() != inner_exe.read_bytes():
        raise RuntimeError("Outer and portable AtlasDesk.exe bytes differ")

    shutil.copy2(portable, FILES / portable.name)
    shutil.copy2(exe, FILES / "AtlasDesk.exe")
    shutil.copy2(checksum, FILES / "SHA256.txt")
    shutil.copy2(manifest, FILES / "build-manifest.txt")

    result = {
        "target": TARGET,
        "tested_head": TESTED,
        "artifact_id": ARTIFACT_ID,
        "artifact_sha256": ARTIFACT_SHA256,
        "portable_zip_sha256": PORTABLE_SHA256,
        "atlasdesk_exe_sha256": EXE_SHA256,
        "atlasdesk_exe_bytes": exe.stat().st_size,
        "compatibility_identity": "PersonalWorkbench",
    }
    (ROOT / "verified-release.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )
    return result


def main() -> None:
    shutil.rmtree(ROOT, ignore_errors=True)
    ROOT.mkdir(parents=True)
    verify_source_equivalence()
    archive = download_artifact()
    result = verify_assets(archive)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
