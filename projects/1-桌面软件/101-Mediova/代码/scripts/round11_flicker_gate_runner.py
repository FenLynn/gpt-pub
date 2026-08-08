from __future__ import annotations

import ctypes
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

EM_SETSEL = 0x00B1
WM_CHAR = 0x0102


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

    send_message = round12_trim_preview_gate.gate.user32.SendMessageW
    send_message.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t]
    send_message.restype = ctypes.c_ssize_t

    def find_ready_editor(pid: int, timeout: float) -> int:
        # Deliberately allow the first trim click to happen while the imported
        # task is still probing. Round12 must close that transient zero-duration
        # editor instead of exposing it. Keep retrying the same real button until
        # the background probe has populated a stable, usable video editor.
        deadline = time.monotonic() + timeout
        main_hwnd = round12_trim_preview_gate.gate.find_window(pid, "Mediova", min(5.0, timeout))
        trim_button = int(
            round12_trim_preview_gate.gate.user32.GetDlgItem(
                main_hwnd, round12_trim_preview_gate.IDC_TRIM_CROP
            )
        )
        if not trim_button:
            raise RuntimeError("trim button disappeared while waiting for probe readiness")

        attempts = 0
        last_title = ""
        while time.monotonic() < deadline:
            editor = int(original_find_editor(pid, 0.8))
            if editor:
                stable_until = time.monotonic() + 0.35
                stable = True
                while time.monotonic() < stable_until:
                    if not round12_trim_preview_gate.gate.user32.IsWindowVisible(editor):
                        stable = False
                        break
                    last_title = round12_trim_preview_gate.gate.window_text(editor)
                    time.sleep(0.05)
                if stable and last_title.startswith("剪裁 ·"):
                    current = int(
                        round12_trim_preview_gate.gate.user32.GetDlgItem(
                            editor, round12_trim_preview_gate.IDC_CURRENT_TIME
                        )
                    )
                    if current:
                        return editor

            # The metadata-not-ready editor is intentionally closed by product
            # code. Once the modal call unwinds, retry the real trim button.
            round12_trim_preview_gate.gate.user32.PostMessageW(
                trim_button, round12_trim_preview_gate.BM_CLICK, 0, 0
            )
            attempts += 1
            time.sleep(0.25)

        raise RuntimeError(
            "trim editor never became metadata-ready after real import: "
            f"attempts={attempts} last_title={last_title!r}"
        )

    def set_current_and_prove_command(editor: int, current_edit: int, jump_button: int, value: str) -> None:
        # Exercise the EDIT control through its normal character-input path
        # instead of cross-process WM_SETTEXT. WM_SETTEXT is programmatic state
        # replacement and can legitimately interact differently with synchronous
        # notification/normalization layers than real typing.
        submitted = "2" if value == "00:00:02.000" else value
        send_message(current_edit, EM_SETSEL, 0, -1)
        for char in submitted:
            send_message(current_edit, WM_CHAR, ord(char), 1)

        written = round12_trim_preview_gate.gate.window_text(current_edit)
        if written != submitted:
            raise RuntimeError(
                "current-time edit did not retain user-like WM_CHAR input before jump command; "
                f"submitted={submitted!r} current_edit={written!r}"
            )

        send_message(jump_button, round12_trim_preview_gate.BM_CLICK, 0, 0)
        if value != "00:00:02.000":
            return

        # Round7 can only canonicalize the deliberately non-canonical "2" to
        # 00:00:02.000 after the real IDC_JUMP_TIME command reaches setCurrent.
        deadline = time.monotonic() + 3.0
        last_text = ""
        while time.monotonic() < deadline:
            last_text = str(round12_trim_preview_gate.child_by_handle(editor, current_edit)["text"])
            if last_text == value:
                return
            time.sleep(0.05)
        raise RuntimeError(
            "Round7 endpoint jump command did not canonicalize user-like input; "
            f"submitted={submitted!r} current_edit={last_text!r} expected={value!r}"
        )

    round12_trim_preview_gate.find_editor = find_ready_editor
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
            stage["metadata_ready_editor_required"] = True
            stage["endpoint_command_canonicalization_required"] = True
            stage["user_like_character_input_required"] = True
            stage["pointer_sized_sendmessage_required"] = True
            stage_path.write_text(json.dumps(stage, ensure_ascii=False, indent=2), encoding="utf-8")

    try:
        return int(round11.main())
    finally:
        merge_stage_evidence()


if __name__ == "__main__":
    sys.exit(main())
