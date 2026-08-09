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
	if entries != 42 {
		t.Errorf("entries=%d want=42", entries)
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
		"cmd/mediaworkbench/v452_round12_trim_preview_guard_windows.go",
		"cmd/mediaworkbench/v452_round12_trim_preview_arm_windows.go",
		"cmd/mediaworkbench/v452_round12_trim_preview_finalize_windows.go",
		"cmd/mediaworkbench/v452_round12_trim_preview_owner_windows.go",
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
		"round12HideNativeListScrollbars",
		"round12ScrollListSubclassProc",
	} {
		if !bytes.Contains(overlaySource, []byte(token)) {
			t.Errorf("transparent scroll overlay source missing %q", token)
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
		"validate_localized_thumb",
		"650ms-visible.png",
	} {
		if !bytes.Contains(scrollGate, []byte(token)) {
			t.Errorf("scroll overlay gate missing %q", token)
		}
	}
}
