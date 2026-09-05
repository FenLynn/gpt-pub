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

const v452Round5ManifestSHA256 = "8f8edc52e03d79f29704b1ddbb7f8ab3445caae1305d1b42ad7dfd2d7596561b"

func TestV452Round5FixedManifest(t *testing.T) {
	manifest := filepath.Join("..", "..", "V452_ROUND5_WINDOWS_CLOSEOUT_FILES_SHA256.txt")
	data, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	if got := hex.EncodeToString(sum[:]); got != v452Round5ManifestSHA256 {
		t.Fatalf("manifest sha256=%s want=%s", got, v452Round5ManifestSHA256)
	}
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		parts := strings.Fields(scanner.Text())
		if len(parts) != 2 {
			t.Fatalf("invalid manifest row %q", scanner.Text())
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
