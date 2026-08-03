package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInspectRuntimeFFmpegAccessDoesNotCreateTree(t *testing.T) {
	root := t.TempDir()
	t.Setenv("MEDIOVA_RUNTIME_DIR", root)

	access := InspectRuntimeFFmpegAccess()
	if !access.Writable || access.PairPresent || access.Err != nil {
		t.Fatalf("unexpected access: %+v", access)
	}
	target, err := RuntimeFFmpegBinDir()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("preflight created Runtime tree: %v", err)
	}
}

func TestInspectRuntimeFFmpegAccessDetectsExistingPair(t *testing.T) {
	root := t.TempDir()
	t.Setenv("MEDIOVA_RUNTIME_DIR", root)
	target, err := RuntimeFFmpegBinDir()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"ffmpeg.exe", "ffprobe.exe"} {
		if err := os.WriteFile(filepath.Join(target, name), []byte(name), 0o755); err != nil {
			t.Fatal(err)
		}
	}

	access := InspectRuntimeFFmpegAccess()
	if !access.Writable || !access.PairPresent || access.Err != nil {
		t.Fatalf("unexpected access: %+v", access)
	}
	if notice := RuntimeFFmpegAccessNotice(access); notice != "" {
		t.Fatalf("writable Runtime produced notice: %q", notice)
	}
}

func TestInspectRuntimeFFmpegAccessDetectsBlockedTree(t *testing.T) {
	root := t.TempDir()
	t.Setenv("MEDIOVA_RUNTIME_DIR", root)
	blocker := filepath.Join(root, "Components")
	if err := os.WriteFile(blocker, []byte("blocking-file"), 0o644); err != nil {
		t.Fatal(err)
	}

	access := InspectRuntimeFFmpegAccess()
	if access.Writable || access.Err == nil {
		t.Fatalf("blocked Runtime accepted: %+v", access)
	}
	notice := RuntimeFFmpegAccessNotice(access)
	if !strings.Contains(notice, "当前不可写") || !strings.Contains(notice, "选择外部组件") {
		t.Fatalf("unexpected notice: %q", notice)
	}
	if err := EnsureRuntimeFFmpegWritable(); err == nil || !strings.Contains(err.Error(), "FFmpeg 菜单") {
		t.Fatalf("missing actionable error: %v", err)
	}
	got, err := os.ReadFile(blocker)
	if err != nil || string(got) != "blocking-file" {
		t.Fatalf("blocking path was modified: %q %v", got, err)
	}
}

func TestRuntimeFFmpegAccessNoticeKeepsExistingPairUsable(t *testing.T) {
	notice := RuntimeFFmpegAccessNotice(RuntimeFFmpegAccess{
		Target:      `C:\Mediova\Components\FFmpeg\bin`,
		PairPresent: true,
		Err:         os.ErrPermission,
	})
	if !strings.Contains(notice, "现有 FFmpeg 可继续使用") || !strings.Contains(notice, "无法导入或更新") {
		t.Fatalf("unexpected notice: %q", notice)
	}
}
