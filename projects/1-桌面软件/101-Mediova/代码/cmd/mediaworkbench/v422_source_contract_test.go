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

func TestV422DesktopSourceContracts(t *testing.T) {
	main := sourceFile(t, "main_windows.go")
	helper := sourceFile(t, "v422_windows.go")
	queue := sourceFile(t, "v420_windows.go")
	harden := sourceFile(t, "v420_harden_windows.go")
	rules := sourceFile(t, "ui_rules.go")
	if strings.Contains(main, "a.a.") {
		t.Fatal("invalid duplicated application receiver returned")
	}
	if strings.Contains(main, "hApplySelected") || strings.Contains(main, "IDC_APPLY_SELECTED") {
		t.Fatal("orphan bottom apply control returned")
	}
	if strings.Contains(main, "case NM_RCLICK:") {
		t.Fatal("duplicate list context-menu trigger returned")
	}
	for _, want := range []string{
		`const appVersion = "4.5.0"`,
		`{"分辨率", 100}, {"时长", 76}`,
		`bottomParameterWidths(a.currentKind)`,
		`drawStatusLamp(dis.HDC, rc, dot)`,
		`drawCompactResetGlyph(dis.HDC, rc, textColor)`,
		`drawContrastCenteredText(hdc, label, bar, fill, uiFontSmall)`,
		`cd.ISubItem != 8 && cd.ISubItem != 9 && cd.ISubItem != 10`,
		`taskDurationText(t)`,
		`a.refreshTotal()`,
	} {
		if !strings.Contains(main, want) {
			t.Fatalf("missing v4.2.2 main contract %q", want)
		}
	}
	if strings.Contains(main, "diameter := scaleDPI(14)") {
		t.Fatal("low-resolution GDI status ellipse returned")
	}
	for _, want := range []string{`drawCenteredText(hdc, "●"`, `for i, unit := range units`, `DT_LEFT|DT_SINGLELINE|DT_CALCRECT`, `centre >= fill.Left && centre <= fill.Right`, `func taskDurationText`, `func (a *application) v422SummarizeProgress`} {
		if !strings.Contains(helper, want) {
			t.Fatalf("missing helper contract %q", want)
		}
	}
	if !strings.Contains(queue, `enable(a.hPause, ownsRun)`) || !strings.Contains(queue, `waitingQueueLabel(runKind)`) {
		t.Fatal("bottom queue controls are not workspace-specific")
	}
	if strings.Count(harden, `a.runKind != a.currentKind`) < 2 {
		t.Fatal("pause/stop can still control the other media workspace")
	}
	if strings.Contains(helper, "withRoundedClip(hdc, fill") {
		t.Fatal("progress text returned to unreliable clipping")
	}
	if !strings.Contains(rules, `kind == model.KindImage`) || !strings.Contains(rules, `Resolution: 122`) {
		t.Fatal("image parameter widths are not independent")
	}
}
