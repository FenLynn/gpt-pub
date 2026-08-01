from __future__ import annotations

import hashlib
import importlib.util
import os
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).with_name("verify_p102_v073_release.py")
spec = importlib.util.spec_from_file_location("p102_release_base", SCRIPT)
if spec is None or spec.loader is None:
    raise RuntimeError("Could not load the P102 release verifier")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def curl_download_artifact() -> Path:
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        raise RuntimeError("GITHUB_TOKEN is missing")
    archive = base.ROOT / "artifact.zip"
    subprocess.run(
        [
            "curl",
            "-fsSL",
            "--retry",
            "3",
            "--retry-delay",
            "2",
            "-H",
            f"Authorization: Bearer {token}",
            "-H",
            "Accept: application/vnd.github+json",
            f"https://api.github.com/repos/{base.REPOSITORY}/actions/artifacts/{base.ARTIFACT_ID}/zip",
            "-o",
            str(archive),
        ],
        check=True,
    )
    if base.sha256(archive) != base.ARTIFACT_SHA256:
        raise RuntimeError("Actions Artifact SHA-256 mismatch")
    return archive


base.download_artifact = curl_download_artifact

if __name__ == "__main__":
    base.main()
