package main

import (
	"strings"
	"testing"
)

func TestDiagnosticStatusCategoriesAndSeverity(t *testing.T) {
	text := "Runtime 组件目录不可写；任务会话保存失败；历史记录主文件异常；数据目录权限不足。"
	categories := diagnosticStatusCategories(text)
	joined := strings.Join(categories, ",")
	for _, want := range []string{"Runtime", "会话", "历史", "数据目录"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing category %q in %v", want, categories)
		}
	}
	if diagnosticStatusSeverity(text) != "warning" {
		t.Fatalf("warning text classified as %q", diagnosticStatusSeverity(text))
	}
	if diagnosticStatusSeverity("配置状态：已继承原配置") != "info" {
		t.Fatal("informational status classified as warning")
	}
}

func TestDiagnosticStatusSummaryRespectsWidthBudget(t *testing.T) {
	text := "配置提醒：Runtime 组件目录不可写且未发现完整 FFmpeg；任务会话主文件异常，已从有效快照恢复；历史记录文件损坏且无有效副本。"
	for width := int32(80); width <= 900; width += 7 {
		summary := diagnosticStatusSummary(text, width)
		budget := diagnosticStatusRuneBudget(width)
		if len([]rune(summary)) > budget {
			t.Fatalf("width=%d summary=%q runes=%d budget=%d", width, summary, len([]rune(summary)), budget)
		}
		if !strings.Contains(summary, "详情") {
			t.Fatalf("width=%d summary lost details affordance: %q", width, summary)
		}
	}
}

func TestDiagnosticStatusSummaryKeepsActiveTaskStatusUnchanged(t *testing.T) {
	for _, text := range []string{
		"正在转换：sample.mp4 · 42%",
		"队列已暂停，剩余 3 个任务",
		"转换失败：编码器退出码 1",
		"智能方案已应用：视频 2 个，图片 1 个",
	} {
		if isDiagnosticStatusText(text) {
			t.Fatalf("active status misclassified as diagnostic: %q", text)
		}
		if got := diagnosticStatusSummary(text, 160); got != text {
			t.Fatalf("active status changed: %q -> %q", text, got)
		}
	}
}

func TestDiagnosticStatusSummarySingleAndMultipleCategories(t *testing.T) {
	single := diagnosticStatusSummary("历史记录保存失败：磁盘已满", 240)
	if !strings.Contains(single, "历史") || !strings.Contains(single, "提醒") {
		t.Fatalf("unexpected single-category summary: %q", single)
	}
	multiple := diagnosticStatusSummary("Runtime 不可用；配置保存失败；任务会话异常；历史记录损坏", 480)
	if !strings.Contains(multiple, "等4项") || !strings.Contains(multiple, "点击查看详情") {
		t.Fatalf("unexpected multi-category summary: %q", multiple)
	}
}

func TestDiagnosticStatusDetailIncludesDiagnosticEntry(t *testing.T) {
	detail := diagnosticStatusDetailText("配置保存失败：access denied")
	if !strings.Contains(detail, "配置保存失败") || !strings.Contains(detail, "帮助 → 诊断报告") {
		t.Fatalf("unexpected detail: %q", detail)
	}
	if got := diagnosticStatusDetailText(" "); !strings.Contains(got, "没有") {
		t.Fatalf("unexpected empty detail: %q", got)
	}
}
