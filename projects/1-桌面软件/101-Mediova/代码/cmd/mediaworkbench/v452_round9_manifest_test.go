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

const v452Round9InteractionManifestSHA256 = "b8294b74ac7763ff21536baaa1d97517f0c3fbee33fa0f2d0b4049d1324a2285"

func TestV452Round9InteractionManifest(t *testing.T) {
	manifest := filepath.Join("..", "..", "V452_ROUND9_REAL_INTERACTION_CLOSEOUT_FILES_SHA256.txt")
	data, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	if got := hex.EncodeToString(sum[:]); got != v452Round9InteractionManifestSHA256 {
		t.Fatalf("round9 manifest sha256=%s want=%s", got, v452Round9InteractionManifestSHA256)
	}
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	entries := 0
	for scanner.Scan() {
		parts := strings.Fields(scanner.Text())
		if len(parts) != 2 || len(parts[0]) != 64 {
			t.Fatalf("invalid round9 manifest row %q", scanner.Text())
		}
		fileData, err := os.ReadFile(filepath.Join("..", "..", parts[1]))
		if err != nil {
			t.Fatalf("read %s: %v", parts[1], err)
		}
		fileData = bytes.ReplaceAll(fileData, []byte("\r\n"), []byte("\n"))
		fileSum := sha256.Sum256(fileData)
		if got := hex.EncodeToString(fileSum[:]); got != parts[0] {
			t.Fatalf("%s sha256=%s want=%s", parts[1], got, parts[0])
		}
		entries++
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if entries != 12 {
		t.Fatalf("round9 manifest entries=%d want=12", entries)
	}
}
