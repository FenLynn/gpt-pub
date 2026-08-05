package main

import (
	"reflect"
	"testing"

	"mediaworkbench/internal/model"
)

func TestRound7FeedbackColumnProfilesAreIndependent(t *testing.T) {
	profiles := round7FeedbackColumnProfiles{}
	video := []int{48, 280, 90}
	image := []int{56, 360, 110}
	profiles.Set(model.KindVideo, video)
	profiles.Set(model.KindImage, image)

	video[0] = 999
	image[0] = 999
	gotVideo := profiles.For(model.KindVideo)
	gotImage := profiles.For(model.KindImage)
	if !reflect.DeepEqual(gotVideo, []int{48, 280, 90}) {
		t.Fatalf("video widths=%v", gotVideo)
	}
	if !reflect.DeepEqual(gotImage, []int{56, 360, 110}) {
		t.Fatalf("image widths=%v", gotImage)
	}
	gotVideo[1] = 777
	if profiles.Video[1] != 280 {
		t.Fatal("returned video profile aliases stored profile")
	}
}

func TestRound7FeedbackHoverIntentUsesOnlyScrollbarEdges(t *testing.T) {
	tests := []struct {
		name  string
		x, y  int
		needH bool
		needV bool
		wantH bool
		wantV bool
	}{
		{"centre", 400, 300, true, true, false, false},
		{"right edge", 991, 300, true, true, false, true},
		{"bottom edge", 400, 691, true, true, true, false},
		{"corner", 991, 691, true, true, true, true},
		{"unneeded", 991, 691, false, false, false, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gotH, gotV := round7FeedbackHoverIntent(1000, 700, tc.x, tc.y, 18, tc.needH, tc.needV)
			if gotH != tc.wantH || gotV != tc.wantV {
				t.Fatalf("got h=%v v=%v want h=%v v=%v", gotH, gotV, tc.wantH, tc.wantV)
			}
		})
	}
}

func TestRound7FeedbackHeldTaskRemainsEditable(t *testing.T) {
	if !round7FeedbackTaskEditable(model.StatusHeld) {
		t.Fatal("held task must be editable")
	}
	if !round7FeedbackTaskEditable(model.StatusReady) {
		t.Fatal("ready task must be editable")
	}
	for _, status := range []model.Status{model.StatusQueued, model.StatusProcessing, model.StatusPaused} {
		if round7FeedbackTaskEditable(status) {
			t.Fatalf("%s must remain locked", status)
		}
	}
}
