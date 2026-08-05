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

const v452Round7ManifestSHA256 = "927da45f13efc75b95281b80014c132ce96597dd999e65bf89379a911f4d361c"

func TestV452Round7HistoricalManifest(t *testing.T) {
	manifest := filepath.Join("..", "..", "V452_ROUND7_CLEAN_REDESIGN_FILES_SHA256.txt")
	data, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	if got := hex.EncodeToString(sum[:]); got != v452Round7ManifestSHA256 {
		t.Fatalf("historical manifest sha256=%s want=%s", got, v452Round7ManifestSHA256)
	}
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	entries := 0
	for scanner.Scan() {
		parts := strings.Fields(scanner.Text())
		if len(parts) != 2 || len(parts[0]) != 64 {
			t.Fatalf("invalid historical manifest row %q", scanner.Text())
		}
		entries++
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if entries != 11 {
		t.Fatalf("historical manifest entries=%d want=11", entries)
	}
}
