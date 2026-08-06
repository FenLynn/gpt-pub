package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRound11FlickerRootFixManifest(t *testing.T) {
	const manifestName = "V452_ROUND11_FLICKER_ROOT_FIX_FILES_SHA256.txt"
	root := filepath.Clean(filepath.Join("..", ".."))
	manifestPath := filepath.Join(root, manifestName)
	file, err := os.Open(manifestPath)
	if err != nil {
		t.Fatalf("open %s: %v", manifestName, err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	entries := 0
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) != 2 {
			t.Errorf("invalid manifest line: %q", line)
			continue
		}
		expected, relative := strings.ToLower(parts[0]), filepath.FromSlash(parts[1])
		data, readErr := os.ReadFile(filepath.Join(root, relative))
		if readErr != nil {
			t.Errorf("read %s: %v", parts[1], readErr)
			continue
		}
		// Git may materialize text files as CRLF on Windows. The manifest
		// freezes repository-normalized LF content so both CI platforms verify
		// the same source bytes rather than checkout-policy side effects.
		data = bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n"))
		sum := sha256.Sum256(data)
		actual := hex.EncodeToString(sum[:])
		if actual != expected {
			t.Errorf("ROUND11_SHA256  %s  %s", actual, parts[1])
		}
		entries++
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scan %s: %v", manifestName, err)
	}
	if entries != 11 {
		t.Fatalf("manifest entry count=%d, want=11", entries)
	}
}
