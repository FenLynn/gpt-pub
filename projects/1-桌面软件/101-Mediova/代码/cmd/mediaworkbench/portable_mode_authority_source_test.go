package main

import (
	"os"
	"strings"
	"testing"
)

func TestPortableModeAuthorityWindowsSourceContract(t *testing.T) {
	content, err := os.ReadFile("portable_mode_authority_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(content)
	for _, required := range []string{
		"SetWindowLongPtrW",
		"portableAuthorityCallWindowProcW.Call",
		"ID_SET_PORTABLE_MODE",
		"portableModeRunActive",
		"flushPortableModeSource",
		"config.PreparePortableModeSwitch",
		"config.SetPortableMode(enable)",
		"current.syncMenuChecks()",
		"模式标记没有改变",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("missing portable authority contract %q", required)
		}
	}
	for _, forbidden := range []string{
		"go func",
		"time.NewTicker",
		"os.RemoveAll(result.SourceDir)",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("portable authority contains forbidden pattern %q", forbidden)
		}
	}
}
