package main

import (
	"testing"

	"mediaworkbench/internal/model"
)

func TestRound12CropSummaries(t *testing.T) {
	task := &model.Task{Duration: 125.9, Width: 1920, Height: 1080}
	top, bottom, active := round12TimeCropLines(task, model.TaskOptions{})
	if active || top != "无" || bottom != "" {
		t.Fatalf("default time crop=(%q,%q,%v)", top, bottom, active)
	}
	opts := model.TaskOptions{TrimStart: 5.8, TrimEnd: 65.9, Crop: model.Crop{Enabled: true, Width: 960, Height: 1080}}
	top, bottom, active = round12TimeCropLines(task, opts)
	if !active || top != "起：00:00:05" || bottom != "止：00:01:05" {
		t.Fatalf("active time crop=(%q,%q,%v)", top, bottom, active)
	}
	if got := round12PictureCropText(task, opts); got != "50%" {
		t.Fatalf("picture crop=%q", got)
	}
}
