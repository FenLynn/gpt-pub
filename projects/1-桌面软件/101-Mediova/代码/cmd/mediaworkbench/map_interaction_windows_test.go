//go:build windows

package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"mediaworkbench/internal/model"
)

func TestLocationFilterAndSortSemantics(t *testing.T) {
	resolved := &model.Task{ID: 1, Location: &model.GeoLocation{Latitude: 36.06, Longitude: 120.38, Place: "青岛市"}}
	gpsOnly := &model.Task{ID: 2, Location: &model.GeoLocation{Latitude: 39.90, Longitude: 116.40}}
	missing := &model.Task{ID: 3}

	if !taskMatchesStatusFilter(resolved, statusFilterLocated) || !taskMatchesStatusFilter(gpsOnly, statusFilterLocated) {
		t.Fatal("valid resolved and GPS-only locations must match the located filter")
	}
	if taskMatchesStatusFilter(missing, statusFilterLocated) || !taskMatchesStatusFilter(missing, statusFilterUnlocated) {
		t.Fatal("missing location filter semantics are inconsistent")
	}
	if got := []int{taskLocationSortRank(resolved), taskLocationSortRank(gpsOnly), taskLocationSortRank(missing)}; got[0] != 0 || got[1] != 1 || got[2] != 2 {
		t.Fatalf("location ranks=%v want [0 1 2]", got)
	}
	if compareTaskColumn(resolved, gpsOnly, taskSortLocation) >= 0 || compareTaskColumn(gpsOnly, missing, taskSortLocation) >= 0 {
		t.Fatal("resolved, GPS-only and missing locations must retain their useful grouping")
	}
}

func TestMapHTMLProvidesBoundedMediaNavigation(t *testing.T) {
	runtime := &mapRuntime{baseURL: "http://127.0.0.1:12345/token"}
	html := runtime.mapHTML()
	for _, required := range []string{
		"getClusterExpansionZoom",
		"getClusterLeaves(clusterID,Math.min",
		"showMediaPopup",
		"items.slice(0,80)",
		"BASE+'/thumb/'",
		"单击定位，双击打开",
		"current-star",
		"clusterProperties:{selected_count",
		"ids=items.filter",
		"type:'play'",
		"'text-field':'★'",
		"clusterMaxZoom:20",
		"popupPlacement",
		"String(p.taskID)",
		"img.dataset.taskId=id",
	} {
		if !strings.Contains(html, required) {
			t.Fatalf("map HTML missing %q", required)
		}
	}
	for _, forbidden := range []string{"Number(p.taskID)", "Number(feature.properties.taskID)", "media-mosaic"} {
		if strings.Contains(html, forbidden) {
			t.Fatalf("map HTML still performs lossy task ID conversion %q", forbidden)
		}
	}
}

func TestMapDefaultsAndMediaViewerRouting(t *testing.T) {
	if !model.DefaultSettings().MapEnabled {
		t.Fatal("map and location features must default to enabled")
	}
	if !model.DefaultSettings().MapFastZoom {
		t.Fatal("fast map zoom must default to enabled")
	}
	if !taskMediaUsesDefaultShell(model.KindImage) {
		t.Fatal("images must open with the Windows default image viewer")
	}
	if taskMediaUsesDefaultShell(model.KindVideo) {
		t.Fatal("videos must retain PotPlayer routing")
	}
}

func TestMapTaskIDSerializesAsExactDecimalString(t *testing.T) {
	id := int64(1770000000000000123)
	data, err := json.Marshal(mapMediaPoint{TaskID: id, TaskKey: strconv.FormatInt(id, 10), Latitude: 1, Longitude: 2})
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatal(err)
	}
	if got, ok := payload["taskID"].(string); !ok || got != "1770000000000000123" {
		t.Fatalf("taskID=%#v must remain an exact decimal string", payload["taskID"])
	}
	if strings.Contains(string(data), `"taskID":177`) {
		t.Fatalf("task ID leaked as a lossy JSON number: %s", data)
	}
}

func TestMapThumbnailRouteUsesExactLargeTaskID(t *testing.T) {
	id := int64(1770000000000000123)
	path := filepath.Join(t.TempDir(), "shared-list-thumbnail.bmp")
	if err := os.WriteFile(path, append([]byte("BM"), make([]byte, 128)...), 0o644); err != nil {
		t.Fatal(err)
	}
	runtime := &mapRuntime{thumbnailPaths: map[int64]string{id: path}}
	req := httptest.NewRequest(http.MethodGet, "/thumb/"+strconv.FormatInt(id, 10), nil)
	recorder := httptest.NewRecorder()
	runtime.serveMapThumbnail(recorder, req, strconv.FormatInt(id, 10))
	if recorder.Code != http.StatusOK || recorder.Body.Len() <= 64 {
		t.Fatalf("thumbnail response status=%d bytes=%d", recorder.Code, recorder.Body.Len())
	}
	if got := recorder.Header().Get("Content-Type"); got != "image/bmp" {
		t.Fatalf("content type=%q", got)
	}
}

func TestMapListCenterDelta(t *testing.T) {
	tests := []struct {
		name                           string
		rowTop, rowBottom, top, bottom int32
		want                           int32
	}{
		{name: "already centered", rowTop: 90, rowBottom: 110, top: 0, bottom: 200, want: 0},
		{name: "below center", rowTop: 170, rowBottom: 190, top: 0, bottom: 200, want: 80},
		{name: "invalid row", rowTop: 10, rowBottom: 10, top: 0, bottom: 200, want: 0},
	}
	for _, tt := range tests {
		if got := mapListCenterDelta(tt.rowTop, tt.rowBottom, tt.top, tt.bottom); got != tt.want {
			t.Errorf("%s: delta=%d want %d", tt.name, got, tt.want)
		}
	}
}

func TestMapHTMLProvidesFastZoomAndShortcuts(t *testing.T) {
	runtime := &mapRuntime{baseURL: "http://127.0.0.1:12345/token"}
	html := runtime.mapHTML()
	for _, required := range []string{
		"setWheelZoomRate",
		"setZoomRate",
		"cancelPendingTileRequestsWhileZooming:true",
		"refreshExpiredTiles:false",
		"maxTileCacheSize:128",
		`id="fit"`,
		`id="current"`,
		`id="map-count"`,
		"'地图点 '+points.length",
		"e.key==='Home'",
		"focusCurrent",
		"type:'camera'",
		"cameraTimer",
		"window.mediovaSpeed",
	} {
		if !strings.Contains(html, required) {
			t.Fatalf("fast map HTML missing %q", required)
		}
	}
}

func TestMapCameraValidationAndInitialView(t *testing.T) {
	if !validMapCamera(120.1234567, 36.1234567, 12.5) {
		t.Fatal("valid saved camera was rejected")
	}
	for _, invalid := range [][3]float64{{181, 0, 3}, {0, 86, 3}, {0, 0, 23}, {0, 0, -1}} {
		if validMapCamera(invalid[0], invalid[1], invalid[2]) {
			t.Fatalf("invalid camera accepted: %v", invalid)
		}
	}
	runtime := &mapRuntime{
		baseURL: "http://127.0.0.1/token",
		app: &application{settings: model.Settings{
			MapFastZoom: true, MapCameraSet: true,
			MapCenterLongitude: 120.1234567, MapCenterLatitude: 36.1234567, MapZoom: 12.5,
		}},
	}
	html := runtime.mapHTML()
	for _, token := range []string{"INITIAL_CENTER=[120.1234567,36.1234567]", "INITIAL_ZOOM=12.500", "INITIAL_FAST=true"} {
		if !strings.Contains(html, token) {
			t.Fatalf("saved camera HTML missing %q", token)
		}
	}
	if !runtime.setCurrentTask(9) || runtime.setCurrentTask(9) {
		t.Fatal("current task change detection must reject duplicate focus")
	}
}
