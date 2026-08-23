//go:build windows

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func testMapCache(t *testing.T, limit int64) *mapCacheManager {
	t.Helper()
	root := filepath.Join(t.TempDir(), "Maps", "OpenFreeMapCache")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	manager := &mapCacheManager{root: root, online: true, limit: limit}
	if err := manager.scanAndPrune(); err != nil {
		t.Fatal(err)
	}
	return manager
}

func TestMapCachePrunesOldestAndHonorsLimit(t *testing.T) {
	manager := testMapCache(t, 9)
	_, generation := manager.state()
	if err := manager.put("https://tiles.openfreemap.org/a", []byte("12345"), generation); err != nil {
		t.Fatal(err)
	}
	if err := manager.put("https://tiles.openfreemap.org/b", []byte("67890"), generation); err != nil {
		t.Fatal(err)
	}
	if got := manager.sizeBytes(); got > 9 {
		t.Fatalf("cache exceeded hard limit: %d", got)
	}
}

func TestMapCacheClearRejectsStaleInflightWrite(t *testing.T) {
	manager := testMapCache(t, 1024)
	_, staleGeneration := manager.state()
	if err := manager.clear(); err != nil {
		t.Fatal(err)
	}
	if err := manager.put("https://tiles.openfreemap.org/stale", []byte("stale"), staleGeneration); err != nil {
		t.Fatal(err)
	}
	if got := manager.sizeBytes(); got != 0 {
		t.Fatalf("stale request repopulated cleared cache: %d", got)
	}
}

func TestMapCacheClearRemovesPartsAndData(t *testing.T) {
	manager := testMapCache(t, 1024)
	_, generation := manager.state()
	if err := manager.put("https://tiles.openfreemap.org/tile", []byte("tile"), generation); err != nil {
		t.Fatal(err)
	}
	part := filepath.Join(manager.root, "orphan.part")
	if err := os.WriteFile(part, []byte("partial"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := manager.clear(); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(manager.root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 || manager.sizeBytes() != 0 {
		t.Fatalf("clear left cache data behind: entries=%d size=%d", len(entries), manager.sizeBytes())
	}
}
