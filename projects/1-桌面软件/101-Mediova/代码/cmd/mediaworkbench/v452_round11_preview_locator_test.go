package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRound11LocateUIPreviewSource(t *testing.T) {
	patterns := []string{"ui-preview", "UIPreview", "uiPreview", "PreviewMode", "previewMode", "video-wide", "StatusHeld"}
	var matches []string
	files, err := filepath.Glob("*.go")
	if err != nil { t.Fatal(err) }
	for _, file := range files {
		f, err := os.Open(file); if err != nil { continue }
		s := bufio.NewScanner(f); line := 0
		for s.Scan() {
			line++
			text := s.Text()
			for _, p := range patterns {
				if strings.Contains(text, p) {
					matches = append(matches, fmt.Sprintf("%s:%d:%s", file, line, strings.TrimSpace(text)))
					break
				}
		}
		f.Close()
	}
	t.Fatalf("ROUND11_UI_PREVIEW_LOCATOR\n%s", strings.Join(matches, "\n"))
}
