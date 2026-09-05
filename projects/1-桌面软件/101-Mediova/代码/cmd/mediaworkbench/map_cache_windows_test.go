//go:build windows

package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
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

func TestMapCacheServesConcurrentReads(t *testing.T) {
	manager := testMapCache(t, 4096)
	const rawURL = "https://tiles.openfreemap.org/tiles/concurrent.pbf"
	_, generation := manager.state()
	if err := manager.put(rawURL, []byte("vector-tile"), generation); err != nil {
		t.Fatal(err)
	}
	errors := make(chan error, 48)
	var wg sync.WaitGroup
	for i := 0; i < 48; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			data, ok := manager.get(rawURL)
			if !ok || string(data) != "vector-tile" {
				errors <- fmt.Errorf("cache read ok=%v data=%q", ok, data)
			}
		}()
	}
	wg.Wait()
	close(errors)
	for err := range errors {
		t.Fatal(err)
	}
}

func TestMapResponsesAllowSafeBrowserReuse(t *testing.T) {
	manager := testMapCache(t, 4096)
	const resource = "tiles/cached.pbf"
	const rawURL = "https://tiles.openfreemap.org/" + resource
	_, generation := manager.state()
	if err := manager.put(rawURL, []byte("cached-vector-tile"), generation); err != nil {
		t.Fatal(err)
	}
	runtime := &mapRuntime{cache: manager, prefix: "/token", baseURL: "http://127.0.0.1/token"}
	tileRecorder := httptest.NewRecorder()
	runtime.serveOpenFreeMap(tileRecorder, httptest.NewRequest(http.MethodGet, "/token/ofm/"+resource, nil), resource)
	if got := tileRecorder.Header().Get("Cache-Control"); got != "private, max-age=86400" {
		t.Fatalf("tile Cache-Control=%q", got)
	}
	pageRecorder := httptest.NewRecorder()
	runtime.serve(pageRecorder, httptest.NewRequest(http.MethodGet, "/token/map", nil))
	if got := pageRecorder.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("map page Cache-Control=%q", got)
	}
}
