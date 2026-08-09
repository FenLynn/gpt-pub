package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRound12ListStructureManifest(t *testing.T) {
	root := filepath.Clean(filepath.Join("..", ".."))
	file, err := os.Open(filepath.Join(root, "V452_ROUND12_LIST_STRUCTURE_FILES_SHA256.txt"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	entries := 0
	seen := map[string]bool{}
	for scanner.Scan() {
		parts := strings.Fields(scanner.Text())
		if len(parts) != 2 || len(parts[0]) != 64 {
			t.Errorf("invalid manifest row %q", scanner.Text())
			continue
		}
		data, readErr := os.ReadFile(filepath.Join(root, filepath.FromSlash(parts[1])))
		if readErr != nil {
			t.Errorf("%s read: %v", parts[1], readErr)
			continue
		}
		data = bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n"))
		sum := sha256.Sum256(data)
		if got := hex.EncodeToString(sum[:]); got != parts[0] {
			t.Errorf("%s sha256=%s want=%s", parts[1], got, parts[0])
		}
		seen[parts[1]] = true
		entries++
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if entries != 47 {
		t.Errorf("entries=%d want=47", entries)
	}
	for _, path := range []string{
		"cmd/mediaworkbench/v452_round7_feedback_columns_windows.go",
		"cmd/mediaworkbench/v452_round8_editor_install_windows.go",
		"cmd/mediaworkbench/v452_round9_thumbnail_lifecycle_windows.go",
		"cmd/mediaworkbench/v452_round9_timeline_windows.go",
		"cmd/mediaworkbench/v452_round9_manifest_test.go",
		"cmd/mediaworkbench/v452_round12_selection_owner_windows.go",
		"cmd/mediaworkbench/v452_round12_header_owner_windows.go",
		"cmd/mediaworkbench/v452_round12_footer_owner_windows.go",
		"cmd/mediaworkbench/v452_round12_activation_bridge_windows.go",
		"cmd/mediaworkbench/v452_round12_list_draw_windows.go",
		"cmd/mediaworkbench/v452_round12_list_geometry_windows.go",
		"cmd/mediaworkbench/v452_round12_scroll_overlay_windows.go",
		"cmd/mediaworkbench/v452_round12_scroll_function_windows.go",
		"cmd/mediaworkbench/v452_round12_trim_preview_guard_windows.go",
		"cmd/mediaworkbench/v452_round12_trim_preview_arm_windows.go",
		"cmd/mediaworkbench/v452_round12_trim_preview_finalize_windows.go",
		"cmd/mediaworkbench/v452_round12_trim_preview_owner_windows.go",
		"cmd/mediaworkbench/v452_round12_native_preview_selftest_windows.go",
		"cmd/mediaworkbench/v452_round12_thumbnail_quality_windows.go",
		"cmd/mediaworkbench/v452_round12_thumbnail_quality_selftest_windows.go",
		"cmd/mediaworkbench/v452_round12_column_profiles_windows.go",
		"cmd/mediaworkbench/v452_round12_preview_windows.go",
		"cmd/mediaworkbench/v452_round12_thumbnail_fallback_windows.go",
		"cmd/mediaworkbench/v452_round12_ui_polish_windows.go",
		"cmd/mediaworkbench/v452_round12_manifest_test.go",
		"cmd/mediaworkbench/v452_thumbnail_lifecycle_windows.go",
		"scripts/round12_list_structure_gate.py",
		"scripts/round12_selection_transition_gate.py",
		"scripts/round12_real_thumbnail_gate.py",
		"scripts/round12_scroll_overlay_gate.py",
		"scripts/round12_scroll_function_gate.py",
		"scripts/round12_trim_preview_gate.py",
		"scripts/round12_remote_memory.py",
		"scripts/round12_remote_header.py",
		"scripts/round12_list_gate_helpers.py",
		"scripts/round12_list_gate_visual.py",
	} {
		if !seen[path] {
			t.Errorf("missing %s", path)
		}
	}

	overlaySource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round12_scroll_overlay_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{
		"round12ScrollWSExLayered",
		"round12ScrollWSExTransparent",
		"round12ScrollLWAColorKey",
		"round12ScrollTransparentKey",
		"round12ShowScrollBar",
		"round12ScrubNativeListScrollStyles",
		"round12HideNativeListScrollbars",
	} {
		if !bytes.Contains(overlaySource, []byte(token)) {
			t.Errorf("transparent scroll overlay source missing %q", token)
		}
	}

	scrollFunctionSource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round12_scroll_function_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{
		"round7FeedbackLVMScroll",
		"round12FunctionalSetScrollFromCover",
		"round12FunctionalHandleMouseWheel",
		"round12FunctionalCurrentHorizontalOffset",
		"round12FunctionalSyncScrollInfo",
		"round12FunctionalListSubclassProc",
	} {
		if !bytes.Contains(scrollFunctionSource, []byte(token)) {
			t.Errorf("functional scroll source missing %q", token)
		}
	}

	footerSource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round12_footer_owner_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{
		"round12FillPolygon",
		"round12DrawSolidIcon",
		"round12IconPlay",
		"round12IconPause",
		"round12IconStop",
		"round12DrawSecondarySolidAction",
	} {
		if !bytes.Contains(footerSource, []byte(token)) {
			t.Errorf("solid action source missing %q", token)
		}
	}

	scrollGate, err := os.ReadFile(filepath.Join(root, "scripts", "round12_scroll_overlay_gate.py"))
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{
		"show_delay_contract_ms",
		"track_transparent",
		"validate_transparent_track",
		"outside_thumb_transparency_required",
		"validate_normal_compact_surface",
		"normal_compact_native_scrollbars_hidden",
		"normal-compact-list-bottom.png",
		"650ms-visible.png",
	} {
		if !bytes.Contains(scrollGate, []byte(token)) {
			t.Errorf("scroll overlay gate missing %q", token)
		}
	}

	scrollFunctionGate, err := os.ReadFile(filepath.Join(root, "scripts", "round12_scroll_function_gate.py"))
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{
		"horizontal_drag_content_moved",
		"mouse_wheel_vertical_moved",
		"vertical_drag_content_moved",
		"direct_listview_scroll_contract",
		"LVM_GETTOPINDEX",
		"LVM_GETSUBITEMRECT",
	} {
		if !bytes.Contains(scrollFunctionGate, []byte(token)) {
			t.Errorf("functional scroll gate missing %q", token)
		}
	}

	thumbnailQualitySource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round12_thumbnail_quality_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{
		"round12ThumbnailQualityForBMP",
		"round12ThumbnailNearBlack",
		"round12ThumbnailCandidateTimes",
		"round12GenerateSmartThumbnailBMP",
		"round12ApprovedDarkThumbnailFallbacks",
	} {
		if !bytes.Contains(thumbnailQualitySource, []byte(token)) {
			t.Errorf("thumbnail quality source missing %q", token)
		}
	}

	thumbnailSelfTestSource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round12_thumbnail_quality_selftest_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{
		"round12_thumbnail_black_intro_fixture",
		"round12_thumbnail_black_sample_detected",
		"round12_thumbnail_retry_selected_nonblack",
		"round12_thumbnail_retry_advanced_time",
		"round12GenerateBlackIntroThumbnailFixture",
	} {
		if !bytes.Contains(thumbnailSelfTestSource, []byte(token)) {
			t.Errorf("thumbnail quality self-test missing %q", token)
		}
	}

	nativePreviewSource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round12_native_preview_selftest_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{
		"round12_preview_exact_end_recovered",
		"round12_preview_sequence_distinct",
		"round12_preview_cancelled_request_rejected",
		"round12_preview_stale_generation_rejected",
		"round12GenerateRecoveredPreview",
		"round12OwnedPreviewCurrent",
	} {
		if !bytes.Contains(nativePreviewSource, []byte(token)) {
			t.Errorf("native preview self-test missing %q", token)
		}
	}

	runnerSource, err := os.ReadFile(filepath.Join(root, "scripts", "round11_flicker_gate_runner.py"))
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{
		"NATIVE_PREVIEW_CHECKS",
		"validate_native_preview_evidence",
		"external_cross_process_trim_injection_required",
		"round12-native-preview-report.json",
		"round12_scroll_function_gate.main()",
		"round12_thumbnail_retry_selected_nonblack",
	} {
		if !bytes.Contains(runnerSource, []byte(token)) {
			t.Errorf("round12 native/scroll gate missing %q", token)
		}
	}
	for _, forbidden := range []string{
		"set_current_via_resilient_jump",
		"WM_COMMAND_WITH_SENDER",
		"round12_trim_preview_gate.main()",
	} {
		if bytes.Contains(runnerSource, []byte(forbidden)) {
			t.Errorf("retired cross-process trim injection remained in runner: %q", forbidden)
		}
	}
}
