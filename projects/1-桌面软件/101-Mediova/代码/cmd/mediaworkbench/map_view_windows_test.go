//go:build windows

package main

import "testing"

func TestMapProjectionAndClustering(t *testing.T) {
	points := []mapMediaPoint{
		{TaskID: 1, Latitude: 36.17410, Longitude: 120.38650},
		{TaskID: 2, Latitude: 36.17412, Longitude: 120.38652},
		{TaskID: 3, Latitude: 39.90420, Longitude: 116.40740},
	}
	plot := rect{Left: 40, Top: 40, Right: 840, Bottom: 440}
	clusters := clusterMapPoints(points, plot)
	if len(clusters) != 2 {
		t.Fatalf("clusters=%d, want 2", len(clusters))
	}
	foundPair := false
	for _, cluster := range clusters {
		if len(cluster.members) == 2 {
			foundPair = true
		}
		if cluster.x < plot.Left || cluster.x > plot.Right || cluster.y < plot.Top || cluster.y > plot.Bottom {
			t.Fatalf("cluster outside plot: %+v", cluster)
		}
	}
	if !foundPair {
		t.Fatal("nearby points were not clustered")
	}
}

func TestMapBoundsExpandSinglePoint(t *testing.T) {
	bounds := mapBoundsForPoints([]mapMediaPoint{{Latitude: 36.1741, Longitude: 120.3865}})
	if bounds.maxLat <= bounds.minLat || bounds.maxLon <= bounds.minLon {
		t.Fatalf("invalid bounds: %+v", bounds)
	}
	x, y := projectMapCoordinate(36.1741, 120.3865, bounds, rect{Left: 0, Top: 0, Right: 100, Bottom: 100})
	if x < 45 || x > 55 || y < 45 || y > 55 {
		t.Fatalf("single point not centered: %d,%d", x, y)
	}
}

func TestMapViewToolbarLabels(t *testing.T) {
	for mode, want := range map[string]string{mapViewList: "列表", mapViewSplit: "分屏", mapViewMap: "地图"} {
		_, label, _, ok := mapViewToolbarSpec(mode)
		if !ok || label != want {
			t.Fatalf("mode=%s label=%q ok=%v", mode, label, ok)
		}
	}
}
