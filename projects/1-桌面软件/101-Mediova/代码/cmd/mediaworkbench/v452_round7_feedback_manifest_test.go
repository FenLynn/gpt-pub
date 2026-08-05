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

const v452Round7FeedbackManifestSHA256 = "06bd1ba5b60ffbbad18dff32ca01958203172e297415fabd83378e8c69b524f2"

func TestV452Round7FeedbackHistoricalManifest(t *testing.T) {
	manifest := filepath.Join("..", "..", "V452_ROUND7_FEEDBACK_FILES_SHA256.txt")
	data, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	if got := hex.EncodeToString(sum[:]); got != v452Round7FeedbackManifestSHA256 {
		t.Fatalf("historical feedback manifest sha256=%s want=%s", got, v452Round7FeedbackManifestSHA256)
	}
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	entries := 0
	for scanner.Scan() {
		parts := strings.Fields(scanner.Text())
		if len(parts) != 2 || len(parts[0]) != 64 {
			t.Fatalf("invalid historical feedback manifest row %q", scanner.Text())
		}
		entries++
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if entries != 9 {
		t.Fatalf("historical feedback manifest entries=%d want=9", entries)
	}
}
