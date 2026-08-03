package main

import (
	"strings"
	"testing"
)

func TestNormalizeStartupConfigNotice(t *testing.T) {
	if got := normalizeStartupConfigNotice("  "); got != "" {
		t.Fatalf("empty notice=%q", got)
	}
	got := normalizeStartupConfigNotice("主配置异常，\n 已从最近有效配置恢复。")
	if got != "配置状态：主配置异常， 已从最近有效配置恢复。" {
		t.Fatalf("notice=%q", got)
	}
	long := normalizeStartupConfigNotice(strings.Repeat("测", 260))
	if len([]rune(strings.TrimPrefix(long, "配置状态："))) != 220 || !strings.HasSuffix(long, "…") {
		t.Fatalf("long notice not bounded: %d %q", len([]rune(long)), long)
	}
}
