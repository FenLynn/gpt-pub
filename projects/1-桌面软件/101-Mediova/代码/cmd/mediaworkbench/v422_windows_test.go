//go:build windows

package main

import (
	"testing"

	"mediaworkbench/internal/model"
)

func TestV422DurationColumnText(t *testing.T) {
	if got := taskDurationText(&model.Task{Kind: model.KindVideo, Duration: 65.4}); got != "01:05" {
		t.Fatalf("video duration=%q", got)
	}
	if got := taskDurationText(&model.Task{Kind: model.KindImage, Duration: 65.4}); got != "—" {
		t.Fatalf("image duration=%q", got)
	}
	if got := taskDurationText(&model.Task{Kind: model.KindVideo}); got != "检测中" {
		t.Fatalf("unknown duration=%q", got)
	}
}

func TestV422QueueLabelsAreMediaSpecific(t *testing.T) {
	if queueStartLabel(model.KindImage) != "开始压缩" || queuePauseLabel(model.KindImage, false) != "暂停压缩" || queueStopLabel(model.KindImage) != "停止压缩" {
		t.Fatal("image queue labels are not independent")
	}
	if queueStartLabel(model.KindVideo) != "开始转换" || queuePauseLabel(model.KindVideo, true) != "继续转换" || queueStopLabel(model.KindVideo) != "停止转换" {
		t.Fatal("video queue labels are not independent")
	}
	if waitingQueueLabel(model.KindVideo) != "等待视频队列" || waitingQueueLabel(model.KindImage) != "等待图片队列" {
		t.Fatal("waiting queue label mismatch")
	}
}
