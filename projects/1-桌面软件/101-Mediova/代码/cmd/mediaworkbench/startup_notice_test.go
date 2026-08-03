package main

import (
	"strings"
	"testing"
)

func TestNormalizeStartupConfigNotice(t *testing.T) {
	if got := normalizeStartupConfigNotice("  "); got != "" {
		t.Fatalf("empty notice=%q", got)
	}
	got := normalizeStartupConfigNotice("已继承原软件配置。")
	if got != "配置状态：已继承原软件配置。" {
		t.Fatalf("info notice=%q", got)
	}
	warning := normalizeStartupConfigNotice("主配置异常，\n 已从最近有效配置恢复。")
	if warning != "配置提醒：主配置异常， 已从最近有效配置恢复。" {
		t.Fatalf("warning notice=%q", warning)
	}
	long := normalizeStartupConfigNotice(strings.Repeat("测", 260))
	if len([]rune(strings.TrimPrefix(long, "配置状态："))) != 220 || !strings.HasSuffix(long, "…") {
		t.Fatalf("long notice not bounded: %d %q", len([]rune(long)), long)
	}
}

func TestStartupStatusAllowsConfigNotice(t *testing.T) {
	for _, current := range []string{"", "就绪", " 准备就绪 ", "请选择文件或文件夹"} {
		if !startupStatusAllowsConfigNotice(current) {
			t.Fatalf("passive status rejected: %q", current)
		}
	}
	for _, current := range []string{
		"正在转换 3/10",
		"已向当前队列加入 5 个任务。",
		"任务失败：磁盘空间不足",
		"队列任务已搁置；修改后点击应用。",
		"默认参数已更新。",
	} {
		if startupStatusAllowsConfigNotice(current) {
			t.Fatalf("active status replaced: %q", current)
		}
	}
}
