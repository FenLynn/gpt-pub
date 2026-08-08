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

WM_LBUTTONDOWN = 0x0201
WM_LBUTTONUP = 0x0202
MK_LBUTTON = 0x0001
ROUND7_IDC_TIMELINE = 4705


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


def install_trim_diagnostics() -> None:
    original_find_editor = round12_trim_preview_gate.find_editor
    user32 = round12_trim_preview_gate.gate.user32

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
                    timeline = int(user32.GetDlgItem(editor, ROUND7_IDC_TIMELINE))
                    if current and timeline:
                        return editor

            user32.PostMessageW(trim_button, round12_trim_preview_gate.BM_CLICK, 0, 0)
            attempts += 1
            time.sleep(0.25)

        raise RuntimeError(
            "trim editor never became metadata-ready after real import: "
            f"attempts={attempts} last_title={last_title!r}"
        )

    def set_current_via_timeline(editor: int, current_edit: int, _jump_button: int, value: str) -> None:
        # Use the real Round7 timeline user path instead of cross-process EDIT
        # text injection. A normal timeline click updates currentAt and, on
        # mouse-up, triggers the same preview request as a desktop user.
        timeline = int(user32.GetDlgItem(editor, ROUND7_IDC_TIMELINE))
        if not timeline:
            raise RuntimeError("Round7 timeline control disappeared")

        rc = round12_trim_preview_gate.gate.RECT()
        if not user32.GetClientRect(timeline, ctypes.byref(rc)):
            raise ctypes.WinError(ctypes.get_last_error())
        width = int(rc.right - rc.left)
        height = int(rc.bottom - rc.top)
        if width < 80 or height < 30:
            raise RuntimeError(f"invalid Round7 timeline geometry: {width}x{height}")

        dpi = 96
        try:
            get_dpi = user32.GetDpiForWindow
            get_dpi.argtypes = [ctypes.c_void_p]
            get_dpi.restype = ctypes.c_uint
            value_dpi = int(get_dpi(editor))
            if 96 <= value_dpi <= 768:
                dpi = value_dpi
        except AttributeError:
            pass
        scale = dpi / 96.0
        left = int(round(26 * scale))
        right = width - int(round(26 * scale))
        y = min(height - 2, max(2, int(round(42 * scale))))
        if right <= left:
            raise RuntimeError(f"invalid Round7 timeline track bounds: left={left} right={right} width={width}")

        target = parse_clock(value)
        fixture_duration = 2.0
        target = max(0.0, min(fixture_duration, target))
        x = int(round(left + (target / fixture_duration) * (right - left)))
        x = max(left, min(right, x))
        lparam = ((y & 0xFFFF) << 16) | (x & 0xFFFF)
        user32.SendMessageW(timeline, WM_LBUTTONDOWN, MK_LBUTTON, lparam)
        user32.SendMessageW(timeline, WM_LBUTTONUP, 0, lparam)

        deadline = time.monotonic() + 3.0
        last_text = ""
        last_value = -1.0
        while time.monotonic() < deadline:
            last_text = str(round12_trim_preview_gate.child_by_handle(editor, current_edit)["text"])
            try:
                last_value = parse_clock(last_text)
            except ValueError:
                last_value = -1.0
            if abs(last_value - target) <= 0.02:
                return
            time.sleep(0.05)
        raise RuntimeError(
            "Round7 timeline click did not update current time: "
            f"target={target:.3f} current_edit={last_text!r} parsed={last_value:.3f}"
        )

    round12_trim_preview_gate.find_editor = find_ready_editor
    round12_trim_preview_gate.set_current_and_jump = set_current_via_timeline


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
            stage["timeline_seek_input_required"] = True
            stage_path.write_text(json.dumps(stage, ensure_ascii=False, indent=2), encoding="utf-8")

    try:
        return int(round11.main())
    finally:
        merge_stage_evidence()


if __name__ == "__main__":
    sys.exit(main())
