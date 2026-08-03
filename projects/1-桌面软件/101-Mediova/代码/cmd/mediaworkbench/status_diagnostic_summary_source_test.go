package main

import (
	"os"
	"strings"
	"testing"
)

func TestStatusDiagnosticSummaryWindowsSourceContract(t *testing.T) {
	content, err := os.ReadFile("status_diagnostic_summary_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(content)
	for _, required := range []string{
		"SetWindowLongPtrW",
		"statusDiagnosticWMSetText",
		"diagnosticStatusSummary(full, statusDiagnosticControlWidth(hwnd))",
		"WM_LBUTTONUP",
		"WM_CONTEXTMENU",
		"ID_HELP_DIAGNOSTICS",
		"writeDiagnosticsWithRuntimeNotice",
		"运行状态详情",
		"a.runtimeNotice",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("missing status diagnostic contract %q", required)
		}
	}
	for _, forbidden := range []string{
		"go func",
		"time.NewTicker",
		"setText(a.hStatusText, a.runtimeNotice)",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("status diagnostic summary contains forbidden pattern %q", forbidden)
		}
	}
}
