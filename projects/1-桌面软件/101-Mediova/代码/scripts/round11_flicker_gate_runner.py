from __future__ import annotations

import json
import sys
from pathlib import Path

import round11_flicker_gate_runner_base as round11
import round12_footer_gate
import round12_header_gate
import round12_list_structure_gate
import round12_real_thumbnail_gate
import round12_scroll_function_gate
import round12_scroll_overlay_gate
import round12_selection_transition_gate

NATIVE_PREVIEW_CHECKS = (
    "round12_preview_fixture",
    "round12_preview_exact_end_recovered",
    "round12_preview_sequence_recovered",
    "round12_preview_sequence_distinct",
    "round12_preview_cancelled_request_rejected",
    "round12_preview_stale_generation_rejected",
    "round12_thumbnail_black_intro_fixture",
    "round12_thumbnail_black_sample_detected",
    "round12_thumbnail_retry_selected_nonblack",
    "round12_thumbnail_retry_advanced_time",
)


def argument_path(name: str) -> Path | None:
    for index, value in enumerate(sys.argv):
        if value == name and index + 1 < len(sys.argv):
            return Path(sys.argv[index + 1]).resolve()
        prefix = name + "="
        if value.startswith(prefix):
            return Path(value[len(prefix):]).resolve()
    return None


def validate_native_preview_evidence() -> dict[str, object]:
    exe = argument_path("--exe")
    if exe is None:
        raise RuntimeError("--exe is required to locate native self-test evidence")
    report_path = exe.parent.parent / "ci_self_test.json"
    if not report_path.is_file():
        raise RuntimeError(f"native self-test report is missing: {report_path}")
    report = json.loads(report_path.read_text(encoding="utf-8"))
    checks = dict(report.get("checks") or {})
    details = dict(report.get("details") or {})
    missing = [name for name in NATIVE_PREVIEW_CHECKS if name not in checks]
    failed = [name for name in NATIVE_PREVIEW_CHECKS if checks.get(name) is not True]
    if missing or failed:
        raise RuntimeError(
            "Round12 native preview/thumbnail coverage is incomplete: "
            f"missing={missing!r} failed={failed!r}"
        )
    return {
        "report": str(report_path),
        "self_test_version": report.get("version"),
        "self_test_passed": report.get("passed"),
        "required_checks": list(NATIVE_PREVIEW_CHECKS),
        "checks": {name: checks[name] for name in NATIVE_PREVIEW_CHECKS},
        "details": {name: details.get(name, "") for name in NATIVE_PREVIEW_CHECKS},
        "external_cross_process_trim_injection_required": False,
        "native_timeline_drag_selftest_required": True,
        "native_preview_generation_selftest_required": True,
        "black_frame_thumbnail_retry_selftest_required": True,
    }


def merge_stage_evidence(native_preview: dict[str, object]) -> None:
    evidence = argument_path("--evidence")
    if evidence is None:
        return
    native_path = evidence / "round12-native-preview-report.json"
    native_path.write_text(json.dumps(native_preview, ensure_ascii=False, indent=2), encoding="utf-8")
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
        ("round12-scroll-function-report.json", "round12_scroll_function"),
        ("round12-native-preview-report.json", "round12_native_preview"),
    ):
        stage_path = evidence / filename
        if stage_path.is_file():
            final[key] = json.loads(stage_path.read_text(encoding="utf-8"))
    final_path.write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    native_preview = validate_native_preview_evidence()

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
    scroll_function_result = int(round12_scroll_function_gate.main())
    if scroll_function_result != 0:
        return scroll_function_result

    try:
        return int(round11.main())
    finally:
        merge_stage_evidence(native_preview)


if __name__ == "__main__":
    sys.exit(main())
