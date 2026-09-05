//go:build windows

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestTransientRunIsolationRedirectsAndRestoresUserData(t *testing.T) {
	original := filepath.Join(t.TempDir(), "interactive-appdata")
	t.Setenv("APPDATA", original)
	t.Setenv("LOCALAPPDATA", original)
	t.Setenv("XDG_CONFIG_HOME", original)

	cleanup := isolateTransientRunData(true)
	defer cleanup()
	isolated := os.Getenv("APPDATA")
	if isolated == "" || isolated == original {
		t.Fatalf("APPDATA was not isolated: %q", isolated)
	}
	if os.Getenv("LOCALAPPDATA") != isolated || os.Getenv("XDG_CONFIG_HOME") != isolated {
		t.Fatal("transient data roots do not share the isolated directory")
	}
	if _, err := os.Stat(isolated); err != nil {
		t.Fatalf("isolated directory is unavailable: %v", err)
	}

	cleanup()
	if got := os.Getenv("APPDATA"); got != original {
		t.Fatalf("APPDATA restored to %q want %q", got, original)
	}
	if _, err := os.Stat(isolated); !os.IsNotExist(err) {
		t.Fatalf("isolated directory was not removed: %v", err)
	}
}
