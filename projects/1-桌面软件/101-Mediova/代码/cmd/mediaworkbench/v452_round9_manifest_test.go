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

const v452Round9InteractionManifestSHA256 = "d2d4dc7c29a41703a66e3631dac09162b0a54ecac624779b1852c17ffa191d73"

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
			t.Errorf("%s sha256=%s want=%s", parts[1], got, parts[0])
		}
		entries++
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if entries != 14 {
		t.Fatalf("round9 manifest entries=%d want=14", entries)
	}
}
