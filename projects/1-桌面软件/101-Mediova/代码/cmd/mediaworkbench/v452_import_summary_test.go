package main

import "testing"

func TestV452ImportFeedbackTextNormalisesDirectFileSummary(t *testing.T) {
	got, ok := v452ImportFeedbackText("已自动分流：视频 2 个，图片 1 个；新增任务已选中。")
	if !ok || got != "导入完成：视频 2 个，图片 1 个" {
		t.Fatalf("got=%q ok=%v", got, ok)
	}
	if got, ok := v452ImportFeedbackText("普通状态"); ok || got != "" {
		t.Fatalf("ordinary status was treated as import: %q %v", got, ok)
	}
}
