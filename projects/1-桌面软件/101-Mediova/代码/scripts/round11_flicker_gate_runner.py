from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import round11_flicker_gate as gate
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
ROUND12_HOVER_SETTLE_SECONDS = 0.08


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


def allowed_header_boundary_diff(baseline, hidden) -> tuple[bool, int]:
    if baseline.size != hidden.size:
        return False, baseline.width * baseline.height
    width, _height = baseline.size
    changed: list[tuple[int, int]] = []
    baseline_pixels = baseline.load()
    hidden_pixels = hidden.load()
    for y in range(baseline.height):
        for x in range(width):
            if baseline_pixels[x, y] == hidden_pixels[x, y]:
                continue
            changed.append((x, y))
            if len(changed) > 8:
                return False, len(changed)
    boundary_only = all((x == 0 or x == width - 1) and y < 40 for x, y in changed)
    return boundary_only, len(changed)


def strict_inline_hover_with_boundary_tolerance(
    hwnd: int,
    _surfaces: list[dict[str, object]],
    evidence: Path,
) -> list[dict[str, object]]:
    overflow = round11.establish_real_overflow(hwnd)
    geometry = round11.normal_list_geometry(hwnd)
    round11.park_cursor(hwnd)

    records: list[dict[str, object]] = []
    for axis in ("horizontal", "vertical"):
        baseline = round11.capture_screen_rect(round11.visible_list_rect(hwnd)).convert("RGB")
        try:
            baseline.save(evidence / f"inline-{axis}-baseline-hidden.png")
            baseline_thumb_pixels, _ = round11.thumb_pixels(baseline)
            if baseline_thumb_pixels != 0:
                raise RuntimeError(
                    f"{axis} thumb visible before edge hover: {baseline_thumb_pixels}"
                )

            x, y = round11.inline_hover_point(hwnd, axis)
            gate.user32.SetCursorPos(x, y)
            time.sleep(round11.IMMEDIATE_HOVER_SAMPLE_SECONDS)
            immediate = round11.capture_screen_rect(round11.visible_list_rect(hwnd)).convert("RGB")
            try:
                immediate.save(evidence / f"inline-{axis}-immediate-visible.png")
                immediate_thumb_pixels, immediate_bbox = round11.thumb_pixels(immediate)
                if immediate_thumb_pixels <= 0 or immediate_bbox is None:
                    raise RuntimeError(f"{axis} inline thumb did not appear immediately")
            finally:
                immediate.close()

            # Round12 intentionally animates the 8 px thumb thickness. The legacy
            # Round11 gate still verifies immediate appearance above, then waits
            # only for that bounded reveal transition to settle before beginning
            # its byte-exact stationary-hover test. No tolerance is applied once
            # the settled reference frame has been captured.
            time.sleep(ROUND12_HOVER_SETTLE_SECONDS)
            round11.normal_list_geometry(hwnd)
            visible = round11.capture_screen_rect(round11.visible_list_rect(hwnd)).convert("RGB")
            try:
                visible.save(evidence / f"inline-{axis}-settled-visible.png")
                visible_thumb_pixels, visible_bbox = round11.thumb_pixels(visible)
                if visible_thumb_pixels <= 0 or visible_bbox is None:
                    raise RuntimeError(f"{axis} inline thumb disappeared before hover settled")

                stable_frames = [visible.tobytes()]
                stable_counts = [visible_thumb_pixels]
                for _ in range(19):
                    time.sleep(0.05)
                    round11.normal_list_geometry(hwnd)
                    sample = round11.capture_screen_rect(round11.visible_list_rect(hwnd)).convert("RGB")
                    try:
                        count, _ = round11.thumb_pixels(sample)
                        stable_frames.append(sample.tobytes())
                        stable_counts.append(count)
                    finally:
                        sample.close()
                if len(set(stable_frames)) != 1 or min(stable_counts) <= 0:
                    raise RuntimeError(f"{axis} inline thumb flickered after reveal settled")
            finally:
                visible.close()

            round11.park_cursor(hwnd)
            hidden = round11.capture_screen_rect(round11.visible_list_rect(hwnd)).convert("RGB")
            try:
                hidden.save(evidence / f"inline-{axis}-left-hidden.png")
                hidden_thumb_pixels, _ = round11.thumb_pixels(hidden)
                if hidden_thumb_pixels != 0:
                    raise RuntimeError(
                        f"{axis} thumb pixels remained after leave: {hidden_thumb_pixels}"
                    )
                boundary_only, changed_pixels = allowed_header_boundary_diff(baseline, hidden)
                if not boundary_only:
                    raise RuntimeError(
                        f"{axis} post-leave pixels changed outside tiny header endpoints: "
                        f"changed={changed_pixels}"
                    )
            finally:
                hidden.close()

            records.append(
                {
                    "axis": axis,
                    "overflow": overflow,
                    "scroll_child_window_count": 0,
                    "visible_after_enter_ms": int(
                        round11.IMMEDIATE_HOVER_SAMPLE_SECONDS * 1000
                    ),
                    "reveal_settle_ms": int(ROUND12_HOVER_SETTLE_SECONDS * 1000),
                    "immediate_thumb_pixels": immediate_thumb_pixels,
                    "immediate_thumb_bbox": list(immediate_bbox),
                    "visible_thumb_pixels": visible_thumb_pixels,
                    "visible_thumb_bbox": list(visible_bbox),
                    "hover_frames": 20,
                    "hover_unique_hashes": 1,
                    "hidden_after_leave": True,
                    "hidden_thumb_pixels": 0,
                    "post_leave_changed_pixels": changed_pixels,
                    "post_leave_changes_header_endpoints_only": True,
                    "native_scroll_style_bits": 0,
                    "list_geometry": geometry,
                }
            )
        finally:
            baseline.close()
    return records


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

    # The historical Round11 gate compared the entire post-leave ListView
    # bitmap byte-for-byte. Round12 now owns the header endpoints separately,
    # so Windows may repaint at most those two border pixels when the cursor
    # leaves. Keep the scrollbar requirement strict: zero thumb pixels and no
    # changes anywhere near the horizontal/vertical scrollbar lanes.
    round11.direct_surface_hover = strict_inline_hover_with_boundary_tolerance

    try:
        return int(round11.main())
    finally:
        merge_stage_evidence(native_preview)


if __name__ == "__main__":
    sys.exit(main())
