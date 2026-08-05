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

const v452Round3ManifestSHA256 = "b34a53118cd666b92407ed852c0e68e5e7e76c65966617ad3b6a727e00bc8333"

const v452Round3ListVisualSupersededByRound11 = "cmd/mediaworkbench/v452_list_visual_windows.go"

func TestV452Round3FixedManifest(t *testing.T) {
	manifest := filepath.Join("..", "..", "V452_ROUND3_IMPORT_OUTPUT_TOAST_FILES_SHA256.txt")
	data, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	if got := hex.EncodeToString(sum[:]); got != v452Round3ManifestSHA256 {
		t.Fatalf("round3 manifest receipt sha256=%s want=%s", got, v452Round3ManifestSHA256)
	}
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	superseded := 0
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
			if parts[1] != v452Round3ListVisualSupersededByRound11 {
				t.Fatalf("%s sha256=%s want=%s", parts[1], got, parts[0])
			}
			superseded++
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if superseded != 1 {
		t.Fatalf("round3 superseded files=%d want=1", superseded)
	}
}
