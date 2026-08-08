from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import round11_flicker_gate_runner_base as round11
import round12_footer_gate
import round12_header_gate
import round12_list_structure_gate
import round12_real_thumbnail_gate
import round12_trim_preview_gate


def argument_path(name: str) -> Path | None:
    for index, value in enumerate(sys.argv):
        if value == name and index + 1 < len(sys.argv):
            return Path(sys.argv[index + 1]).resolve()
        prefix = name + "="
        if value.startswith(prefix):
            return Path(value[len(prefix):]).resolve()
    return None


def install_trim_diagnostics() -> None:
    original_find_editor = round12_trim_preview_gate.find_editor
    original_set_current_and_jump = round12_trim_preview_gate.set_current_and_jump

    def find_final_editor(pid: int, timeout: float) -> int:
        editor = int(original_find_editor(pid, timeout))
        deadline = time.monotonic() + 8.0
        last_title = ""
        while time.monotonic() < deadline:
            last_title = round12_trim_preview_gate.gate.window_text(editor)
            if last_title.startswith("剪裁 ·"):
                return editor
            time.sleep(0.05)
        raise RuntimeError(
            "final Round8/Round11 trim editor installer did not complete before preview validation: "
            f"title={last_title!r}"
        )

    def set_current_and_prove_command(editor: int, current_edit: int, jump_button: int, value: str) -> None:
        # For the endpoint probe, deliberately enter a non-canonical value.
        # Round7 can only rewrite it to 00:00:02.000 after WM_COMMAND reaches
        # its real jump handler and setCurrent() has updated currentAt.
        submitted = "2" if value == "00:00:02.000" else value
        original_set_current_and_jump(editor, current_edit, jump_button, submitted)
        if value != "00:00:02.000":
            return
        deadline = time.monotonic() + 3.0
        last_text = ""
        while time.monotonic() < deadline:
            last_text = str(round12_trim_preview_gate.child_by_handle(editor, current_edit)["text"])
            if last_text == value:
                return
            time.sleep(0.05)
        raise RuntimeError(
            "Round7 endpoint jump command did not canonicalize the requested time; "
            f"submitted={submitted!r} current_edit={last_text!r} expected={value!r}"
        )

    round12_trim_preview_gate.find_editor = find_final_editor
    round12_trim_preview_gate.set_current_and_jump = set_current_and_prove_command


def merge_stage_evidence() -> None:
    evidence = argument_path("--evidence")
    if evidence is None:
        return
    final_path = evidence / "flicker-report.json"
    if not final_path.is_file():
        return
    final = json.loads(final_path.read_text(encoding="utf-8"))
    for filename, key in (
        ("footer-report.json", "round12_footer"),
        ("header-report.json", "round12_header"),
        ("round12-list-report.json", "round12_list"),
        ("round12-real-thumbnail-report.json", "round12_real_thumbnail"),
        ("round12-trim-preview-report.json", "round12_trim_preview"),
    ):
        stage_path = evidence / filename
        if stage_path.is_file():
            final[key] = json.loads(stage_path.read_text(encoding="utf-8"))
    final_path.write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    footer_result = int(round12_footer_gate.main())
    if footer_result != 0:
        return footer_result
    header_result = int(round12_header_gate.main())
    if header_result != 0:
        return header_result
    list_result = int(round12_list_structure_gate.main())
    if list_result != 0:
        return list_result
    thumbnail_result = int(round12_real_thumbnail_gate.main())
    if thumbnail_result != 0:
        return thumbnail_result

    install_trim_diagnostics()
    trim_preview_passes = 0
    trim_preview_required = 2
    for _attempt in range(trim_preview_required):
        trim_preview_result = int(round12_trim_preview_gate.main())
        if trim_preview_result != 0:
            return trim_preview_result
        trim_preview_passes += 1

    evidence = argument_path("--evidence")
    if evidence is not None:
        stage_path = evidence / "round12-trim-preview-report.json"
        if stage_path.is_file():
            stage = json.loads(stage_path.read_text(encoding="utf-8"))
            stage["fresh_process_passes"] = trim_preview_passes
            stage["fresh_process_required"] = trim_preview_required
            stage["final_editor_installer_required"] = True
            stage["endpoint_command_canonicalization_required"] = True
            stage_path.write_text(json.dumps(stage, ensure_ascii=False, indent=2), encoding="utf-8")

    try:
        return int(round11.main())
    finally:
        merge_stage_evidence()


if __name__ == "__main__":
    sys.exit(main())
