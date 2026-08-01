//go:build !windows

package media

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestProbeContextHonorsDeadline(t *testing.T) {
	dir := t.TempDir()
	helper := filepath.Join(dir, "slow-ffprobe.sh")
	if err := os.WriteFile(helper, []byte("#!/bin/sh\nexec sleep 10\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := ProbeContext(ctx, helper, filepath.Join(dir, "input.mp4"))
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("probe deadline was not enforced: %v", elapsed)
	}
}
