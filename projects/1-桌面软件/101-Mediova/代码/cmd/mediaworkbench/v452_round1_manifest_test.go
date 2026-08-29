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

const v452Round1ManifestSHA256 = "873dd396a57eef4fb72475d1619d1f3d787c2243695929afed52f84e95a211fc"

func TestV452Round1FixedManifest(t *testing.T) {
	manifest := filepath.Join("..", "..", "V452_ROUND1_UI_STATE_FILES_SHA256.txt")
	data, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	if got := hex.EncodeToString(sum[:]); got != v452Round1ManifestSHA256 {
		t.Fatalf("manifest sha256=%s want=%s", got, v452Round1ManifestSHA256)
	}
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		parts := strings.Fields(scanner.Text())
		if len(parts) != 2 {
			t.Fatalf("invalid manifest row %q", scanner.Text())
		}
		// The manifest is an immutable Round1 receipt. main_windows.go has been
		// superseded by later rounds, so only its recorded historical digest is
		// retained here; current source belongs to the active Round12 receipt.
		if parts[1] == "cmd/mediaworkbench/main_windows.go" {
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
