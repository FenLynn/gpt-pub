package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRound11LocateTaskListCreation(t *testing.T) {
	patterns := []string{"func (a *application) initControls", "a.hList", "LVS_REPORT", "WC_LISTVIEW", "SysListView32"}
	var matches []string
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		f, err := os.Open(file)
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(f)
		line := 0
		for scanner.Scan() {
			line++
			text := scanner.Text()
			for _, pattern := range patterns {
				if strings.Contains(text, pattern) {
					matches = append(matches, fmt.Sprintf("%s:%d: %s", file, line, strings.TrimSpace(text)))
					break
				}
			}
		}
		f.Close()
	}
	t.Fatalf("ROUND11_SOURCE_LOCATOR\n%s", strings.Join(matches, "\n"))
}
