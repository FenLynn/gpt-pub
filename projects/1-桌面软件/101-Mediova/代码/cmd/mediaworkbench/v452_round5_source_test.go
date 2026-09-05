package main

import (
	"os"
	"strings"
	"testing"
)

func TestV452Round5WindowsCloseoutSourceContract(t *testing.T) {
	data, err := os.ReadFile("v452_round5_closeout_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	for _, token := range []string{
		"WM_APP_SELFTEST",
		"v452Round5CaptureWindowPNG",
		"round5_timeline_start_drag",
		"round5_timeline_end_drag",
		"round5_timeline_playhead_drag",
		"round5_timeline_range_drag",
		"prefix+\"_crop_\"+tc.name",
		"{\"north_east\", media.CropHandleNorthEast",
		"{\"east\", media.CropHandleEast",
		"{\"south_east\", media.CropHandleSouthEast",
		"{\"south\", media.CropHandleSouth",
		"{\"south_west\", media.CropHandleSouthWest",
		"{\"west\", media.CropHandleWest",
		"{\"north_west\", media.CropHandleNorthWest",
		"round5_import_toast_manual_close",
		"checks[\"round5_ffmpeg_matrix_\"+tc.name]",
		"{\"r0\", \"不旋转\"",
		"{\"r90\", \"90°右转\"",
		"{\"r180\", \"180°\"",
		"{\"r270\", \"90°左转\"",
	} {
		if !strings.Contains(source, token) {
			t.Fatalf("missing round-five closeout contract token %q", token)
		}
	}
	if !strings.Contains(source, "v452Round5SelfTestRequested(os.Args[1:])") {
		t.Fatal("round-five closeout must remain restricted to native self-test mode")
	}
	if strings.Contains(source, "time.NewTicker") || strings.Contains(source, "for app == nil") {
		t.Fatal("round-five installation must remain event-driven, not polling-based")
	}
}
