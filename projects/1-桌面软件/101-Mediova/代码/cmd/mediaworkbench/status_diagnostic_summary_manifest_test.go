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

const statusDiagnosticSummaryManifestSHA256 = "0bb1764e7276b33b1aafb7f9135d4e1f9880631db50707a7c32d0a9d575d39ce"

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
