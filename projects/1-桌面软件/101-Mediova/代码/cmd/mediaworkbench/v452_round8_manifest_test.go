package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const v452Round8ConvergenceManifestSHA256 = "90d4c369e0ba35ea15fb657e4eafc56c33adbc7a089eae25fb624fbeab60057e"

// Round 8 is a historical receipt. Its manifest and rows must remain intact,
// but later rounds are allowed to supersede listed implementation files.
func TestV452Round8ConvergenceManifestReceipt(t *testing.T) {
	manifest := filepath.Join("..", "..", "V452_ROUND8_UI_CONVERGENCE_FILES_SHA256.txt")
	data, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	if got := hex.EncodeToString(sum[:]); got != v452Round8ConvergenceManifestSHA256 {
		t.Fatalf("round8 manifest sha256=%s want=%s", got, v452Round8ConvergenceManifestSHA256)
	}
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	entries := 0
	for scanner.Scan() {
		parts := strings.Fields(scanner.Text())
		if len(parts) != 2 || len(parts[0]) != 64 || !strings.HasPrefix(parts[1], "cmd/mediaworkbench/") {
			t.Fatalf("invalid round8 manifest row %q", scanner.Text())
		}
		entries++
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if entries != 19 {
		t.Fatalf("round8 manifest entries=%d want=19", entries)
	}
}
