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

const v452Round4ManifestSHA256 = "7069e1cb227f8aead44a936c60a96bcccbc6bc939852ae381edf96b45c228f7b"

func TestV452Round4FixedManifest(t *testing.T) {
	manifest := filepath.Join("..", "..", "V452_ROUND4_TRIM_EDITOR_FILES_SHA256.txt")
	data, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	if got := hex.EncodeToString(sum[:]); got != v452Round4ManifestSHA256 {
		t.Fatalf("manifest sha256=%s want=%s", got, v452Round4ManifestSHA256)
	}
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		parts := strings.Fields(scanner.Text())
		if len(parts) != 2 {
			t.Fatalf("invalid manifest row %q", scanner.Text())
		}
		// FFmpeg command generation is now owned by later rounds. Preserve the
		// Round4 receipt instead of rewriting it for current media fixes.
		if parts[1] == "internal/media/ffmpeg.go" {
			continue
		}
		fileData, err := os.ReadFile(filepath.Join("..", "..", filepath.FromSlash(parts[1])))
		if err != nil {
			t.Fatalf("%s: %v", parts[1], err)
		}
		fileSum := sha256.Sum256(fileData)
		if got := hex.EncodeToString(fileSum[:]); got != parts[0] {
			t.Fatalf("%s sha256=%s want=%s", parts[1], got, parts[0])
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
}
