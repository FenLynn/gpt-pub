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

const v452Round7ManifestSHA256 = "927da45f13efc75b95281b80014c132ce96597dd999e65bf89379a911f4d361c"

func round7CanonicalText(data []byte) []byte {
	return bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n"))
}

func TestV452Round7FixedManifest(t *testing.T) {
	manifest := filepath.Join("..", "..", "V452_ROUND7_CLEAN_REDESIGN_FILES_SHA256.txt")
	data, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	canonicalManifest := round7CanonicalText(data)
	sum := sha256.Sum256(canonicalManifest)
	if got := hex.EncodeToString(sum[:]); got != v452Round7ManifestSHA256 {
		t.Fatalf("manifest sha256=%s want=%s", got, v452Round7ManifestSHA256)
	}
	scanner := bufio.NewScanner(strings.NewReader(string(canonicalManifest)))
	entries := 0
	for scanner.Scan() {
		parts := strings.Fields(scanner.Text())
		if len(parts) != 2 {
			t.Fatalf("invalid manifest row %q", scanner.Text())
		}
		fileData, err := os.ReadFile(filepath.Join("..", "..", filepath.FromSlash(parts[1])))
		if err != nil {
			t.Fatalf("%s: %v", parts[1], err)
		}
		fileSum := sha256.Sum256(round7CanonicalText(fileData))
		if got := hex.EncodeToString(fileSum[:]); got != parts[0] {
			t.Fatalf("%s sha256=%s want=%s", parts[1], got, parts[0])
		}
		entries++
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if entries != 11 {
		t.Fatalf("manifest entries=%d want=11", entries)
	}
}
