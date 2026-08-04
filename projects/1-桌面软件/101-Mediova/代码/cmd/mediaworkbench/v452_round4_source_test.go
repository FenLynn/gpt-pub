package main

import (
	"os"
	"strings"
	"testing"
)

func v452RequireRound4Source(t *testing.T, path string, wants ...string) string {
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
	return text
}

func TestV452Round4TrimEditorSourceContracts(t *testing.T) {
	hook := v452RequireRound4Source(t, "v452_trim_hook_windows.go",
		"SetWinEventHook",
		"裁剪 · ",
		"v452PaintTrimTimeline",
		"v452TrimPreviewMouseDown",
		"v452ReleaseTrimState",
		"v452RemoveSubclass.Call",
	)
	for _, forbidden := range []string{"time.NewTicker", "go func(", "for {"} {
		if strings.Contains(hook, forbidden) {
			t.Fatalf("trim hook contains forbidden polling pattern %q", forbidden)
		}
	}

	v452RequireRound4Source(t, "v452_trim_editor_windows.go",
		"media.HitTrimTimeline",
		"media.DragTrimTimeline",
		"media.MoveCrop",
		"media.ResizeCrop",
		"media.DragCropWithAspect",
		"v452PaintCropHandles",
		"WM_CTLCOLORSTATIC",
	)

	v452RequireRound4Source(t, "../../internal/media/crop_interaction.go",
		"CropHandleNorthWest",
		"CropHandleNorthEast",
		"CropHandleSouthEast",
		"CropHandleSouthWest",
		"RotateCropRect",
		"UnrotateCropRect",
	)

	v452RequireRound4Source(t, "../../internal/media/trim_filter_order_test.go",
		"rotation must precede crop",
		"crop must precede scale",
	)
}
