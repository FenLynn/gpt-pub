package main

import (
	"os"
	"strings"
	"testing"
)

func TestV430PreviewCropSourceContracts(t *testing.T) {
	trim, err := os.ReadFile("trim_dialog_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	main, err := os.ReadFile("main_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"IDC_CROP_ASPECT", "应用到已选任务", "func (d *trimDialog) keyDown", "media.DragCropWithAspect", "media.FitAspectCrop"} {
		if !strings.Contains(string(trim), want) {
			t.Fatalf("missing v4.3.0 trim contract %q", want)
		}
	}
	if !strings.Contains(string(main), "applySelected := showTrimCropDialog") || !strings.Contains(string(main), "copyTrimCropToTargets") {
		t.Fatal("batch trim/crop apply path missing")
	}
}
