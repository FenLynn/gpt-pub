package main

import (
	"os"
	"strings"
	"testing"
)

func TestV452Round2SourceContracts(t *testing.T) {
	mainData, err := os.ReadFile("main_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	main := string(mainData)
	for _, want := range []string{
		"var taskListColumns = v452TaskListColumns",
		"taskColOutputSize && cd.ISubItem != taskColProgress && cd.ISubItem != taskColStatus",
		"v452InstallThumbnailAsset",
		"v452ReleaseTaskThumbnails",
		"ID_CTX_EXIT_QUEUE",
		"a.v452OpenTaskDirectory(output)",
	} {
		if !strings.Contains(main, want) {
			t.Fatalf("missing round-two contract %q", want)
		}
	}
	for _, forbidden := range []string{
		"cd.ISubItem != 8 && cd.ISubItem != 9 && cd.ISubItem != 10",
		"func (a *application) openSelectedDir(output bool) {\n\tt, _ := a.selectedTask()",
	} {
		if strings.Contains(main, forbidden) {
			t.Fatalf("legacy round-two path returned: %q", forbidden)
		}
	}
}
