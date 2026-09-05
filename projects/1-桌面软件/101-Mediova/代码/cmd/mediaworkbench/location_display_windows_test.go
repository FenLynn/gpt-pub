//go:build windows

package main

import (
	"testing"

	"mediaworkbench/internal/model"
)

func TestRound12LocationTextHasThreeDistinctStates(t *testing.T) {
	if got := round12LocationText(&model.Task{}); got != "—" {
		t.Fatalf("missing location=%q", got)
	}
	coordinate := &model.Task{Location: &model.GeoLocation{Latitude: 36.0671, Longitude: 120.3826}}
	if got := round12LocationText(coordinate); got != "GPS · 36.0671, 120.3826" {
		t.Fatalf("coordinate location=%q", got)
	}
	detailed := &model.Task{Location: &model.GeoLocation{Latitude: 36.0671, Longitude: 120.3826, Place: "五四广场 · 青岛市"}}
	if got := round12LocationText(detailed); got != "地点 · 五四广场 · 青岛市" {
		t.Fatalf("detailed location=%q", got)
	}
	if round12LocationColor(coordinate) == round12LocationColor(detailed) ||
		round12LocationColor(coordinate) == round12LocationColor(&model.Task{}) {
		t.Fatal("location states must use distinct colors")
	}
}
