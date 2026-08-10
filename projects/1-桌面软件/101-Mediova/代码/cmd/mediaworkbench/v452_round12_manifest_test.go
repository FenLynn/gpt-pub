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

	assertContains := func(name string, data []byte, tokens ...string) {
		t.Helper()
		for _, token := range tokens {
			if !bytes.Contains(data, []byte(token)) {
				t.Errorf("%s missing %q", name, token)
			}
		}
	}
	assertAbsent := func(name string, data []byte, tokens ...string) {
		t.Helper()
		for _, token := range tokens {
			if bytes.Contains(data, []byte(token)) {
				t.Errorf("%s retained retired token %q", name, token)
			}
		}
	}

	overlaySource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round12_scroll_overlay_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("clipped ListView viewport", overlaySource,
		"round12ViewportEnsure",
		"round12ViewportGutter",
		"round12ViewportCreateRectRgn",
		"round12ViewportSetWindowRgn",
		"round12ViewportRegionWidth",
		"round12InstallInlineListScroll",
	)
	assertAbsent("clipped ListView viewport", overlaySource,
		"SetLayeredWindowAttributes",
		"MWRound11StableScrollSurface",
		"MWRound9ScrollCover",
		"CreateWindowExW",
	)

	scrollSource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round12_scroll_function_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("inline scroll owner", scrollSource,
		"round12InstallInlineListScroll",
		"round12InlineTrackRect",
		"round12InlineThumbRect",
		"round12InlineDrawThumb",
		"round12InlineBeginDrag",
		"round12InlineSetScrollFromPoint",
		"round12InlineHandleMouseWheel",
		"round12InlineListSubclassProc",
		"round12InlineHoverDelay",
		"round7FeedbackLVMScroll",
	)
	assertAbsent("inline scroll owner", scrollSource,
		"round7FeedbackSetScrollInfo.Call",
		"procRedrawWindow.Call",
		"WM_SETREDRAW",
		"SetWindowRgn",
		"CreateWindowExW",
	)

	installOrder, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round11_install_order_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("scroll install order", installOrder,
		"round11RetireLegacyOverlayWindows",
		"round12InstallInlineListScroll",
		"round7FeedbackListSubclassCB",
		"round11ListSubclassCB",
	)
	assertAbsent("scroll install order", installOrder, "round11InstallStableScrollSurfaces")

	legacyRetire, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round11_legacy_overlay_retire_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("legacy scrollbar retirement", legacyRetire,
		"round9DestroyScrollOverlays",
		"procDestroyWindow.Call",
		"round11StableCoverH = nil",
		"round11StableCoverV = nil",
	)
	assertAbsent("legacy scrollbar retirement", legacyRetire, "round11RetiredScrollHWND")

	footerSource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round12_footer_owner_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("action icon source", footerSource,
		"round12FillPolygon",
		"round12DrawSolidIcon",
		"round12IconPlay",
		"round12IconPause",
		"round12IconStop",
		"round12DrawSecondarySolidAction",
		"secondaryButtonGlyph",
		"round12DrawPolishedButtonContent",
	)

	scrollGate, err := os.ReadFile(filepath.Join(root, "scripts", "round12_scroll_overlay_gate.py"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("clipped viewport visual gate", scrollGate,
		"clipped-native-gutter-single-inline-thumb",
		"scrollbar_child_windows_forbidden",
		"native_scrollbars_clipped_outside_viewport",
		"HOVER_DELAY_MS = 500",
		"track_transparent",
		"outside_thumb_change",
		"MWRound9ScrollCover",
		"MWRound11StableScrollSurface",
	)

	scrollFunctionGate, err := os.ReadFile(filepath.Join(root, "scripts", "round12_scroll_function_gate.py"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("clipped viewport function gate", scrollFunctionGate,
		"clipped-native-gutter-single-inline-thumb",
		"horizontal_drag_content_moved",
		"mouse_wheel_vertical_moved",
		"vertical_drag_content_moved",
		"native_scrollbars_clipped_outside_viewport_throughout_interaction",
		"scrollbar_child_window_count",
		"MWRound9ScrollCover",
		"MWRound11StableScrollSurface",
	)

	thumbnailQualitySource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round12_thumbnail_quality_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("thumbnail quality source", thumbnailQualitySource,
		"round12ThumbnailQualityForBMP",
		"round12ThumbnailNearBlack",
		"round12ThumbnailCandidateTimes",
		"round12GenerateSmartThumbnailBMP",
		"round12ApprovedDarkThumbnailFallbacks",
	)

	thumbnailSelfTestSource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round12_thumbnail_quality_selftest_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("thumbnail quality self-test", thumbnailSelfTestSource,
		"round12_thumbnail_black_intro_fixture",
		"round12_thumbnail_black_sample_detected",
		"round12_thumbnail_retry_selected_nonblack",
		"round12_thumbnail_retry_advanced_time",
		"round12GenerateBlackIntroThumbnailFixture",
	)

	nativePreviewSource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round12_native_preview_selftest_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("native preview self-test", nativePreviewSource,
		"round12_preview_exact_end_recovered",
		"round12_preview_sequence_distinct",
		"round12_preview_cancelled_request_rejected",
		"round12_preview_stale_generation_rejected",
		"round12GenerateRecoveredPreview",
		"round12OwnedPreviewCurrent",
	)

	runnerSource, err := os.ReadFile(filepath.Join(root, "scripts", "round11_flicker_gate_runner.py"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("round12 native/scroll runner", runnerSource,
		"NATIVE_PREVIEW_CHECKS",
		"validate_native_preview_evidence",
		"external_cross_process_trim_injection_required",
		"round12-native-preview-report.json",
		"round12_scroll_overlay_gate.main()",
		"round12_scroll_function_gate.main()",
		"round12_thumbnail_retry_selected_nonblack",
	)
	assertAbsent("round12 native/scroll runner", runnerSource,
		"set_current_via_resilient_jump",
		"WM_COMMAND_WITH_SENDER",
		"round12_trim_preview_gate.main()",
	)
}
