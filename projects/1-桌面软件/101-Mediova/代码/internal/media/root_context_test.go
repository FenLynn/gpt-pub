package media

import (
	"path/filepath"
	"testing"
)

func TestRootContextRoundTripAndSafety(t *testing.T) {
	encoded := EncodeRootContext(`C:\素材`, `..\D:盘/server`)
	root, prefix := DecodeRootContext(encoded)
	if root != `C:\素材` {
		t.Fatalf("root=%q", root)
	}
	if prefix != "D_盘_server" {
		t.Fatalf("prefix=%q", prefix)
	}
	output := OutputRootForContext(filepath.Join("Z:", "out"), encoded)
	if output != filepath.Join("Z:", "out", prefix) {
		t.Fatalf("output=%q", output)
	}
}

func TestResolveRootContextUsesDialogCommonFolder(t *testing.T) {
	base := t.TempDir()
	dialogDir := filepath.Join(base, "旅行")
	input := filepath.Join(dialogDir, "clip.mp4")
	root, prefix := ResolveRootContext(input, "", dialogDir)
	if root != base || prefix != "" {
		t.Fatalf("root=%q prefix=%q", root, prefix)
	}
}

func TestDecodeRootContextLeavesLegacyValueUntouched(t *testing.T) {
	legacy := filepath.Join("D:", "素材")
	root, prefix := DecodeRootContext(legacy)
	if root != legacy || prefix != "" {
		t.Fatalf("root=%q prefix=%q", root, prefix)
	}
}
