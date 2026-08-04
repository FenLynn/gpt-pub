package main

import (
	"os"
	"strings"
	"testing"
)

func round7ReadSource(t *testing.T, name string) string {
	t.Helper()
	data, err := os.ReadFile(name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return string(data)
}

func TestRound7MainInstallsOnceAndUnhooksEventListener(t *testing.T) {
	source := round7ReadSource(t, "v452_round7_main_windows.go")
	for _, required := range []string{
		"round7MainInstalled.Load()",
		"round7UnhookWinEvent.Call(round7MainEventHook)",
		"round7MainEventHook = 0",
		"case WM_SIZE:",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("missing one-shot main-window guard: %q", required)
		}
	}
	for _, forbidden := range []string{"time.NewTicker", "SetTimer", "WM_TIMER", "for {\n\t\tprocInvalidateRect"} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("continuous repaint mechanism is forbidden: %q", forbidden)
		}
	}
	if count := strings.Count(source, "procPostMessageW.Call(app.hwnd, round7WMInit"); count != 1 {
		t.Fatalf("round7 init message count=%d, want 1", count)
	}
}

func TestRound7StatusLampIsSupersampledAndFooterArrowFacesRight(t *testing.T) {
	source := round7ReadSource(t, "v452_round7_main_windows.go")
	for _, required := range []string{
		"const samples = 4",
		"round7StretchDIBits.Call",
		"diameter := int(scaleDPI(15))",
		"Right-facing triangle",
		"iconCenterX + scaleDPI(6)",
		"round7LayoutFooter(app)",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("missing visual contract: %q", required)
		}
	}
}

func TestRound7EditorUsesRequestedNamesAndFiveMarkers(t *testing.T) {
	source := round7ReadSource(t, "v452_round7_editor_windows.go")
	for _, required := range []string{
		"剪辑 / 画面",
		"设定起始时间",
		"设为当前",
		"设为初始",
		"设定结束时间",
		"设为终止",
		"源起点",
		"剪辑起点",
		"当前",
		"剪辑终点",
		"源终点",
		"round7DragTrimStart",
		"round7DragCurrent",
		"round7DragTrimEnd",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("missing editor contract: %q", required)
		}
	}
	for _, forbidden := range []string{"设为起点", "设为终点", "range drag", "TrimTimelineRange", "time.NewTicker", "WM_TIMER"} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("rejected editor behaviour remains: %q", forbidden)
		}
	}
}

func TestRound7CurrentPreviewIsReleasedNotMouseMoveGenerated(t *testing.T) {
	source := round7ReadSource(t, "v452_round7_editor_windows.go")
	moveStart := strings.Index(source, "case WM_MOUSEMOVE:")
	moveEnd := strings.Index(source[moveStart:], "case WM_LBUTTONUP:")
	if moveStart < 0 || moveEnd < 0 {
		t.Fatal("timeline mouse handlers missing")
	}
	moveBlock := source[moveStart : moveStart+moveEnd]
	if strings.Contains(moveBlock, "generatePreviewFrame") {
		t.Fatal("preview generation during WM_MOUSEMOVE would cause flashing")
	}
	upStart := strings.Index(source, "case WM_LBUTTONUP:")
	upEnd := strings.Index(source[upStart:], "result, _, _ := procDefWindowProcW")
	if upStart < 0 || upEnd < 0 {
		t.Fatal("timeline mouse-up block missing")
	}
	upBlock := source[upStart : upStart+upEnd]
	if !strings.Contains(upBlock, "if drag == round7DragCurrent") || !strings.Contains(upBlock, "generatePreviewFrame") {
		t.Fatal("current preview must be generated once after current cursor release")
	}
}
