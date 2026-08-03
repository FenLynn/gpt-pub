package main

import "strings"

func startupConfigNoticeSeverity(notice string) string {
	lower := strings.ToLower(notice)
	for _, token := range []string{"未完成", "不可用", "异常", "损坏", "失败", "错误", "只读"} {
		if strings.Contains(lower, strings.ToLower(token)) {
			return "warning"
		}
	}
	return "info"
}

func normalizeStartupConfigNotice(notice string) string {
	notice = strings.Join(strings.Fields(strings.TrimSpace(notice)), " ")
	if notice == "" {
		return ""
	}
	runes := []rune(notice)
	if len(runes) > 220 {
		notice = string(runes[:219]) + "…"
	}
	if startupConfigNoticeSeverity(notice) == "warning" {
		return "配置提醒：" + notice
	}
	return "配置状态：" + notice
}

func startupStatusAllowsConfigNotice(current string) bool {
	current = strings.Join(strings.Fields(strings.TrimSpace(current)), " ")
	if current == "" {
		return true
	}
	if strings.HasPrefix(current, "就绪。") || strings.HasPrefix(current, "就绪 ") {
		return true
	}
	for _, passive := range []string{
		"就绪",
		"准备就绪",
		"请选择文件",
		"请选择文件或文件夹",
		"等待添加任务",
		"当前没有任务",
	} {
		if current == passive {
			return true
		}
	}
	return false
}

func mergeStartupRuntimeNotice(existing, notice string) string {
	existing = strings.Join(strings.Fields(strings.TrimSpace(existing)), " ")
	notice = strings.Join(strings.Fields(strings.TrimSpace(notice)), " ")
	switch {
	case existing == "":
		return notice
	case notice == "" || strings.Contains(existing, notice):
		return existing
	default:
		return existing + " " + notice
	}
}
