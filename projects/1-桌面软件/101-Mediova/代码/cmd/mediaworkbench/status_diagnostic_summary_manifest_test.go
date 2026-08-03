package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const statusDiagnosticSummaryManifestSHA256 = "AUTO"

func TestStatusDiagnosticSummaryFixedSourceManifest(t *testing.T) {
	root := filepath.Clean(filepath.Join("..", ".."))
	manifestPath := filepath.Join(root, "STATUS_DIAGNOSTIC_SUMMARY_FILES_SHA256.txt")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	manifestSum := sha256.Sum256(data)
	manifestHash := hex.EncodeToString(manifestSum[:])

	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	entries := 0
	auto := statusDiagnosticSummaryManifestSHA256 == "AUTO"
	var actual []string
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
		gotHash := hex.EncodeToString(got[:])
		actual = append(actual, fmt.Sprintf("%s  %s", gotHash, path))
		if want == "AUTO" {
			auto = true
		} else if gotHash != want {
			t.Fatalf("%s hash mismatch: %s", path, gotHash)
		}
		entries++
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if auto {
		t.Fatalf("replace AUTO values:\nmanifest_sha256=%s\n%s", manifestHash, strings.Join(actual, "\n"))
	}
	if manifestHash != statusDiagnosticSummaryManifestSHA256 {
		t.Fatalf("status diagnostic manifest hash mismatch: %s", manifestHash)
	}
	if entries != 4 {
		t.Fatalf("manifest entries=%d want 4", entries)
	}
}
