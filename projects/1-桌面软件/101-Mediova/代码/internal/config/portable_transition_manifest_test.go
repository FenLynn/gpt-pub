package config

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const portableModeAuthorityManifestSHA256 = "96208e694a6945845e21e02d21d588d81581949cba917a3d833a23812a3e1bcf"

func TestPortableModeAuthorityFixedSourceManifest(t *testing.T) {
	root := filepath.Clean(filepath.Join("..", ".."))
	manifestPath := filepath.Join(root, "PORTABLE_MODE_AUTHORITY_FILES_SHA256.txt")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != portableModeAuthorityManifestSHA256 {
		t.Fatalf("portable authority manifest hash mismatch: %x", sum)
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
		if hex.EncodeToString(got[:]) != want {
			t.Fatalf("%s hash mismatch: %x", path, got)
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
