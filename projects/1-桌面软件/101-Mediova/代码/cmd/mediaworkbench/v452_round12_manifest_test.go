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
	if entries != 54 {
		t.Errorf("entries=%d want=54", entries)
	}

	for _, path := range []string{
		"cmd/mediaworkbench/main_windows.go",
		"cmd/mediaworkbench/winapi_windows.go",
		"cmd/mediaworkbench/progress_refresh_windows_test.go",
		"internal/media/ffmpeg.go",
		"internal/media/stream_compatibility_test.go",
		"cmd/mediaworkbench/v452_round8_editor_install_windows.go",
		"cmd/mediaworkbench/v452_round11_install_order_windows.go",
		"cmd/mediaworkbench/v452_round9_thumbnail_lifecycle_windows.go",
		"cmd/mediaworkbench/v452_round9_timeline_windows.go",
		"cmd/mediaworkbench/v452_round9_manifest_test.go",
		"cmd/mediaworkbench/v452_round12_selection_owner_windows.go",
		"cmd/mediaworkbench/v452_round12_header_owner_windows.go",
		"cmd/mediaworkbench/v452_round12_footer_owner_windows.go",
		"cmd/mediaworkbench/v452_round12_activation_bridge_windows.go",
		"cmd/mediaworkbench/v452_round12_list_draw_windows.go",
		"cmd/mediaworkbench/v452_round12_status_glyph_windows.go",
		"cmd/mediaworkbench/v452_round12_list_geometry_windows.go",
		"cmd/mediaworkbench/v452_round12_trim_preview_guard_windows.go",
		"cmd/mediaworkbench/v452_round12_trim_preview_arm_windows.go",
		"cmd/mediaworkbench/v452_round12_trim_preview_finalize_windows.go",
		"cmd/mediaworkbench/v452_round12_trim_preview_owner_windows.go",
		"cmd/mediaworkbench/v452_round12_native_preview_selftest_windows.go",
		"cmd/mediaworkbench/v452_round12_thumbnail_quality_windows.go",
		"cmd/mediaworkbench/v452_round12_thumbnail_quality_selftest_windows.go",
		"cmd/mediaworkbench/v452_round12_column_profiles_windows.go",
		"cmd/mediaworkbench/v452_round12_column_profiles_windows_test.go",
		"cmd/mediaworkbench/v452_round12_preview_windows.go",
		"cmd/mediaworkbench/v452_round12_thumbnail_fallback_windows.go",
		"cmd/mediaworkbench/v452_round12_ui_polish_windows.go",
		"cmd/mediaworkbench/v452_round12_manifest_test.go",
		"cmd/mediaworkbench/v452_thumbnail_lifecycle_windows.go",
		"scripts/round12_list_structure_gate.py",
		"scripts/round12_selection_transition_gate.py",
		"scripts/round12_overall_progress_gate.py",
		"scripts/round12_real_thumbnail_gate.py",
		"scripts/round12_scroll_overlay_gate.py",
		"scripts/round11_flicker_gate_runner_base.py",
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

	installOrder, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round11_install_order_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("native ListView scroll owner", installOrder,
		"round12InstallNativeListScroll",
		"round7FeedbackWSHScroll|round7FeedbackWSVScroll",
		"LVS_EX_DOUBLEBUFFER",
	)
	assertAbsent("native ListView scroll owner", installOrder,
		"round11RetireLegacyOverlayWindows",
		"round12InstallInlineListScroll",
		"round12InstallPostPaintOwner",
		"round12InstallScrollVisualFinalizer",
		"round7FeedbackListSubclassCB",
		"round11ListSubclassCB",
	)

	for _, retired := range []string{
		"v452_round7_feedback_scroll_windows.go",
		"v452_round8_list_style_guard_windows.go",
		"v452_round10_scroll_cover_windows.go",
		"v452_round11_legacy_overlay_retire_windows.go",
		"v452_round11_stable_scroll_surfaces_windows.go",
		"v452_round12_scroll_function_windows.go",
		"v452_round12_scroll_overlay_windows.go",
		"v452_round12_thumb_strip_finalizer_windows.go",
	} {
		if _, statErr := os.Stat(filepath.Join(root, "cmd", "mediaworkbench", retired)); !os.IsNotExist(statErr) {
			t.Errorf("retired scroll source still exists: %s (err=%v)", retired, statErr)
		}
	}

	profileSource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round12_column_profiles_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("compact persistent column profiles", profileSource,
		"round12ColumnProfileVersion = 4",
		"round12DefaultColumnVisible",
		"round12MigrateLegacyProfile",
		"config.LoadJSON",
		"config.SaveJSON",
		"round12LoadLegacyWidthProfiles",
	)
	assertAbsent("compact persistent column profiles", profileSource,
		"os.WriteFile(path, data, 0o644)",
		"round7FeedbackSaveColumnProfiles",
	)

	selectionSource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round12_selection_owner_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("targeted selection repaint", selectionSource,
		"case LVN_ITEMCHANGED:",
		"round12InvalidateTaskSelectionNeighborhood(a, int(n.IItem))",
		"round12DrawBufferedOverallProgress(a, dis)",
	)
	assertAbsent("targeted selection repaint", selectionSource,
		"procInvalidateRect.Call(a.hList, 0, 0)",
	)
	assertAbsent("non-reentrant selection repaint", selectionSource,
		"procUpdateWindow.Call(a.hList)",
	)
	footerSource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round12_footer_owner_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("DPI-stable solid footer glyphs", footerSource,
		"round12DrawSolidFooterGlyph",
		"round12DrawAAGlyph(hdc, x, y, size, glyph, foreground, background)",
		"round12DrawMessageBar",
		"round12DrawFooterTiming",
		"round12DrawToolbarAction",
		"round12DrawSecondaryBadgeContent",
		"round12PaintUnifiedMenuBoundary",
	)
	assertAbsent("DPI-stable solid footer glyphs", footerSource,
		"round12FooterVectorGlyph",
	)
	listVisualSource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_list_visual_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("footer-only ordinary feedback", listVisualSource,
		"round12InstallFooterMessageFeedback(a)",
	)
	assertAbsent("footer-only ordinary feedback", listVisualSource,
		"\n\tv452InstallImportFeedback(a)\n",
	)
	overlaySource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "overlay_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("completion-only animated toast", overlaySource,
		"drawVerticalGradient",
		"v452ImportToastFrameAt",
		"beginCompletionToastClose",
		"app.toastTitle",
		"app.toastBody",
		"procSetTimer.Call(hwnd, TIMER_TOAST_CLOSE, 2000, 0)",
	)
	listDrawSource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round12_list_draw_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("status backgrounds and grouped selection outline", listDrawSource,
		"round12TaskBackground(task.Status)",
		"case CDDS_ITEMPOSTPAINT:",
		"round12DrawSelectionOutline",
		"!listItemSelected(a.hList, row-1)",
		"!listItemSelected(a.hList, row+1)",
		"round12FillTrailingRowArea(a, cd.NMCD.HDC, row, round12TaskBackground(task.Status))",
		"round12DrawBufferedOverallProgress",
		"round7FeedbackBitBlt.Call",
		"round12VisibleCellBounds",
	)
	statusGlyphSource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "v452_round12_status_glyph_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("supersampled semantic status glyphs", statusGlyphSource,
		"const samples = 8",
		"round12GlyphRing",
		"round12GlyphQueue",
		"round12GlyphPlay",
		"round12GlyphPause",
		"round12GlyphCircle",
		"round12GlyphCross",
		"round12GlyphSquare",
		"round12DrawAAStatusGlyph",
	)
	assertAbsent("row-cached native selection draw", listDrawSource,
		"cd.NMCD.ItemState&CDIS_SELECTED != 0",
	)

	mainSource, err := os.ReadFile(filepath.Join(root, "cmd", "mediaworkbench", "main_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("coalesced progress refresh", mainSource,
		"postProgressRow",
		"TIMER_PROGRESS_FLUSH",
		"updateTaskProgressRowByID",
		"round12ColOutputSize, round12ColProgress, round12ColStatus",
		"len(a.settings.TaskColumnWidths) == 0 && !round12ListStructureReady(a)",
		"procPostMessageW.Call(a.hwnd, WM_APP_SELECTION, 0, 0)",
		"IDC_OVERALL_PROGRESS",
		"createControl(\"BUTTON\", \"选中转换\"",
		"return \"\\uE768\" // Play: convert the selected tasks",
		"uiFontProgress = createUIFont(\"Microsoft YaHei UI\", -13, 400)",
		"a.hTimeText = createControl",
		"footerOverallLabel(0, 0, 0)",
	)

	progressGate, err := os.ReadFile(filepath.Join(root, "scripts", "round12_overall_progress_gate.py"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("atomic overall progress visual gate", progressGate,
		"IDC_OVERALL_PROGRESS",
		"frames_validated",
		"buffered_atomic_paint",
		"text_never_blank",
	)

	scrollGate, err := os.ReadFile(filepath.Join(root, "scripts", "round12_scroll_overlay_gate.py"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("native scroll visual gate", scrollGate,
		"native-listview-scrollbars",
		"custom_scrollbar_windows_forbidden",
		"native_scroll_style_bits",
		"MWRound12ThumbVisual",
		"MWRound12FrozenNumber",
		"MWRound9ScrollCover",
		"MWRound11StableScrollSurface",
	)
	assertAbsent("native scroll visual gate", scrollGate,
		"single-listview-inline-thumb",
		"outside_thumb_change",
	)

	scrollFunctionGate, err := os.ReadFile(filepath.Join(root, "scripts", "round12_scroll_function_gate.py"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains("native scroll function gate", scrollFunctionGate,
		"NATIVE_SCROLL_ARCHITECTURE",
		"horizontal_native_page_moved",
		"WM_HSCROLL",
		"SB_PAGERIGHT",
		"mouse_wheel_vertical_moved",
		"WM_MOUSEWHEEL",
		"custom_scrollbar_window_count",
	)
	assertAbsent("native scroll function gate", scrollFunctionGate,
		"single-listview-inline-thumb",
		"round12InlineSetScrollFromPoint",
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
