package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func sourceFile(t *testing.T, rel string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.FromSlash(rel))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestV421DesktopSourceContracts(t *testing.T) {
	main := sourceFile(t, "main_windows.go")
	if strings.Contains(main, "hApplySelected") || strings.Contains(main, "IDC_APPLY_SELECTED") {
		t.Fatal("orphan bottom 应用到选中 control returned")
	}
	if !strings.Contains(main, `a.hTaskApply = createControl("BUTTON", "应用到选中"`) {
		t.Fatal("right-panel 应用到选中 control missing")
	}
	if strings.Contains(main, "case NM_RCLICK:") {
		t.Fatal("list context menu must not be triggered by both NM_RCLICK and WM_CONTEXTMENU")
	}
	for _, want := range []string{
		`const appVersion = "4.2.1"`,
		`createControl("BUTTON", "浏览"`,
		`defer procDestroyMenu.Call(m)`,
		`diameter := scaleDPI(14)`,
		`preferred := scaleDPI(24)`,
	} {
		if !strings.Contains(main, want) {
			t.Fatalf("missing v4.2.1 desktop contract %q", want)
		}
	}
	if strings.Contains(main, `WS_OVERLAPPEDWINDOW|WS_VISIBLE|WS_CLIPCHILDREN`) {
		t.Fatal("main window must not become visible before controls/layout are ready")
	}
}
