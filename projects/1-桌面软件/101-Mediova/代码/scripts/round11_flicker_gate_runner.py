from __future__ import annotations

import ctypes
import json
import sys
import time
from ctypes import wintypes
from pathlib import Path

import round11_flicker_gate_runner_base as round11
import round12_footer_gate
import round12_header_gate
import round12_list_structure_gate
import round12_real_thumbnail_gate
import round12_scroll_overlay_gate
import round12_selection_transition_gate
import round12_trim_preview_gate

WM_COMMAND = 0x0111
WM_SETTEXT = 0x000C
BM_CLICK = 0x00F5
IDC_JUMP_TIME = 4016


def argument_path(name: str) -> Path | None:
    for index, value in enumerate(sys.argv):
        if value == name and index + 1 < len(sys.argv):
            return Path(sys.argv[index + 1]).resolve()
        prefix = name + "="
        if value.startswith(prefix):
            return Path(value[len(prefix):]).resolve()
    return None


def parse_clock(value: str) -> float:
    parts = value.strip().split(":")
    if len(parts) == 3:
        return float(parts[0]) * 3600.0 + float(parts[1]) * 60.0 + float(parts[2])
    if len(parts) == 2:
        return float(parts[0]) * 60.0 + float(parts[1])
    return float(value)


def canonical_clock(value: float) -> str:
    value = max(0.0, value)
    hours = int(value // 3600.0)
    value -= hours * 3600.0
    minutes = int(value // 60.0)
    seconds = value - minutes * 60.0
    return f"{hours:02d}:{minutes:02d}:{seconds:06.3f}"


def noncanonical_clock(value: float) -> str:
    value = max(0.0, value)
    hours = int(value // 3600.0)
    value -= hours * 3600.0
    minutes = int(value // 60.0)
    seconds = value - minutes * 60.0
    return f"{hours}:{minutes}:{seconds:.3f}"


def install_trim_diagnostics() -> None:
    original_find_editor = round12_trim_preview_gate.find_editor
    user32 = round12_trim_preview_gate.gate.user32

    # Keep all cross-process HWND/WPARAM/LPARAM calls pointer-sized on Win64.
    user32.GetDlgItem.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.GetDlgItem.restype = wintypes.HWND
    user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.SendMessageW.restype = ctypes.c_ssize_t
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.PostMessageW.restype = wintypes.BOOL
    send_message = user32.SendMessageW

    def find_ready_editor(pid: int, timeout: float) -> int:
        # Real imports can enter the list before FFprobe has populated duration
        # and dimensions. Product code closes that transient editor; retry the
        # real trim button until the stable metadata-ready editor exists.
        deadline = time.monotonic() + timeout
        main_hwnd = round12_trim_preview_gate.gate.find_window(pid, "Mediova", min(5.0, timeout))
        trim_button = int(user32.GetDlgItem(main_hwnd, round12_trim_preview_gate.IDC_TRIM_CROP))
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
                    if not user32.IsWindowVisible(editor):
                        stable = False
                        break
                    last_title = round12_trim_preview_gate.gate.window_text(editor)
                    time.sleep(0.05)
                if stable and last_title.startswith("剪裁 ·"):
                    current = int(user32.GetDlgItem(editor, round12_trim_preview_gate.IDC_CURRENT_TIME))
                    if current:
                        return editor

            user32.PostMessageW(trim_button, round12_trim_preview_gate.BM_CLICK, 0, 0)
            attempts += 1
            time.sleep(0.25)

        raise RuntimeError(
            "trim editor never became metadata-ready after real import: "
            f"attempts={attempts} last_title={last_title!r}"
        )

    def set_current_via_resilient_jump(editor: int, current_edit: int, jump_button: int, value: str) -> None:
        # The old hosted-desktop gate tried to emulate the four seek buttons by
        # sending WM_COMMAND with no sender HWND. That transport is not faithful
        # to a real button notification and is intermittent on hosted Windows.
        # Drive the actual jump control instead. A noncanonical but valid time is
        # written first; successful product handling rewrites it to the canonical
        # clock, which gives us an explicit acknowledgement before preview checks.
        target = parse_clock(value)
        expected = canonical_clock(target)
        raw_value = noncanonical_clock(target)
        transports: list[tuple[str, object]] = [
            ("BM_CLICK", lambda: send_message(jump_button, BM_CLICK, 0, 0)),
            (
                "WM_COMMAND_WITH_SENDER",
                lambda: send_message(editor, WM_COMMAND, IDC_JUMP_TIME, jump_button),
            ),
            (
                "POST_BM_CLICK",
                lambda: user32.PostMessageW(jump_button, BM_CLICK, 0, 0),
            ),
        ]
        attempts: list[dict[str, object]] = []
        last_text = ""

        for name, trigger in transports:
            text = ctypes.create_unicode_buffer(raw_value)
            send_message(current_edit, WM_SETTEXT, 0, ctypes.addressof(text))
            trigger()
            deadline = time.monotonic() + 1.5
            while time.monotonic() < deadline:
                last_text = str(round12_trim_preview_gate.child_by_handle(editor, current_edit)["text"])
                if last_text == expected:
                    return
                time.sleep(0.05)
            attempts.append({"transport": name, "last_text": last_text})

        raise RuntimeError(
            "jump navigation was not acknowledged by the editor: "
            f"requested={value!r} raw={raw_value!r} expected={expected!r} attempts={attempts!r}"
        )

    round12_trim_preview_gate.find_editor = find_ready_editor
    round12_trim_preview_gate.set_current_and_jump = set_current_via_resilient_jump


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
        ("round12-selection-transition-report.json", "round12_selection_transition"),
        ("round12-real-thumbnail-report.json", "round12_real_thumbnail"),
        ("round12-scroll-overlay-report.json", "round12_scroll_overlay"),
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
    selection_result = int(round12_selection_transition_gate.main())
    if selection_result != 0:
        return selection_result
    thumbnail_result = int(round12_real_thumbnail_gate.main())
    if thumbnail_result != 0:
        return thumbnail_result
    scroll_overlay_result = int(round12_scroll_overlay_gate.main())
    if scroll_overlay_result != 0:
        return scroll_overlay_result

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
            stage["resilient_jump_navigation_required"] = True
            stage["jump_transport_order"] = ["BM_CLICK", "WM_COMMAND_WITH_SENDER", "POST_BM_CLICK"]
            stage["native_timeline_drag_selftest_required"] = True
            stage["pointer_sized_win32_abi_required"] = True
            stage_path.write_text(json.dumps(stage, ensure_ascii=False, indent=2), encoding="utf-8")

    try:
        return int(round11.main())
    finally:
        merge_stage_evidence()


if __name__ == "__main__":
    sys.exit(main())
