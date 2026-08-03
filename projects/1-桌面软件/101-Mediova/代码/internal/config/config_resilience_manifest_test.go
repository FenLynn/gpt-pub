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

const configResilienceManifestSHA256 = "eb86349b11785485b1c02d98801c48de8294a3670c3e2a15b019aaa854217a6d"

func TestConfigResilienceFixedSourceManifest(t *testing.T) {
	root := filepath.Clean(filepath.Join("..", ".."))
	manifestPath := filepath.Join(root, "CONFIG_RESILIENCE_FILES_SHA256.txt")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != configResilienceManifestSHA256 {
		t.Fatalf("config resilience manifest hash mismatch: %x", sum)
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
	if entries != 6 {
		t.Fatalf("manifest entries=%d want 6", entries)
	}
}
