package main

import (
	"os"
	"strings"
	"testing"
)

func v452RequireRound3Source(t *testing.T, path string, wants ...string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, want := range wants {
		if !strings.Contains(text, want) {
			t.Fatalf("%s missing %q", path, want)
		}
	}
}

func TestV452Round3SourceContracts(t *testing.T) {
	v452RequireRound3Source(t, "v452_list_visual_windows.go", "v452InstallImportFeedback(a)")
	v452RequireRound3Source(t, "v452_import_feedback_windows.go",
		"SetLayeredWindowAttributes",
		"WS_EX_TOOLWINDOW|WS_EX_TOPMOST|WS_EX_NOACTIVATE|v452WSExLayered",
		"v452ImportToastVisibleTime",
	)
	v452RequireRound3Source(t, "v452_round2_logic.go", "media.OutputRootForContext")
	v452RequireRound3Source(t, "../../internal/media/direct_file_groups.go", "EncodeRootContext(plainRoot, prefix)")
	v452RequireRound3Source(t, "../../internal/media/files.go",
		"ResolveRootContext(input, root, settings.LastInputDir)",
		"OutputRootWithPrefix(outputDir, outputPrefix)",
	)
}
