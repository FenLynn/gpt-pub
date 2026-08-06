from __future__ import annotations

import json
import sys
from pathlib import Path

import round11_flicker_gate_runner_base as round11
import round12_footer_gate


def argument_path(name: str) -> Path | None:
    for index, value in enumerate(sys.argv):
        if value == name and index + 1 < len(sys.argv):
            return Path(sys.argv[index + 1]).resolve()
        prefix = name + "="
        if value.startswith(prefix):
            return Path(value[len(prefix):]).resolve()
    return None


def merge_footer_evidence() -> None:
    evidence = argument_path("--evidence")
    if evidence is None:
        return
    footer_path = evidence / "footer-report.json"
    final_path = evidence / "flicker-report.json"
    if not footer_path.is_file() or not final_path.is_file():
        return
    footer = json.loads(footer_path.read_text(encoding="utf-8"))
    final = json.loads(final_path.read_text(encoding="utf-8"))
    final["round12_footer"] = footer
    final_path.write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    footer_result = int(round12_footer_gate.main())
    if footer_result != 0:
        return footer_result
    try:
        return int(round11.main())
    finally:
        merge_footer_evidence()


if __name__ == "__main__":
    sys.exit(main())
