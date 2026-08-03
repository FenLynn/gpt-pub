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

const statusDiagnosticSummaryManifestSHA256 = "3e34e21e24f911f262669848ffa5714317bf3e12e7b8e31b25417eb420be37a2"

func TestStatusDiagnosticSummaryFixedSourceManifest(t *testing.T) {
	root := filepath.Clean(filepath.Join("..", ".."))
	manifestPath := filepath.Join(root, "STATUS_DIAGNOSTIC_SUMMARY_FILES_SHA256.txt")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	manifestSum := sha256.Sum256(data)
	if got := hex.EncodeToString(manifestSum[:]); got != statusDiagnosticSummaryManifestSHA256 {
		t.Fatalf("status diagnostic manifest hash mismatch: %s", got)
	}

	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	entries := 0
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) != 2 {
			t.Fatalf("invalid manifest line: %q", line)
		}
		want, path := parts[0], parts[1]
		content, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(path)))
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		got := sha256.Sum256(content)
		if gotHash := hex.EncodeToString(got[:]); gotHash != want {
			t.Fatalf("%s hash mismatch: %s", path, gotHash)
		}
		entries++
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if entries != 4 {
		t.Fatalf("manifest entries=%d want 4", entries)
	}
}
