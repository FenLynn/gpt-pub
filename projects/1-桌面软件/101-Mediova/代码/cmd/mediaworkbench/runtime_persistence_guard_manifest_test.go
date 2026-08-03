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

const runtimePersistenceGuardManifestSHA256 = "d06d8e50cfefbcf95b1b154c28b912a6ad7a0bd06bf98edfabe567a68a5b2d71"

func TestRuntimePersistenceGuardFixedSourceManifest(t *testing.T) {
	root := filepath.Clean(filepath.Join("..", ".."))
	manifestPath := filepath.Join(root, "RUNTIME_PERSISTENCE_GUARD_FILES_SHA256.txt")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != runtimePersistenceGuardManifestSHA256 {
		t.Fatalf("runtime persistence manifest hash mismatch: %x", sum)
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
