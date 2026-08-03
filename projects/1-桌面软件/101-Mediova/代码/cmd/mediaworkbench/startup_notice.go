package main

import "strings"

func normalizeStartupConfigNotice(notice string) string {
	notice = strings.Join(strings.Fields(strings.TrimSpace(notice)), " ")
	if notice == "" {
		return ""
	}
	runes := []rune(notice)
	if len(runes) > 220 {
		notice = string(runes[:219]) + "…"
	}
	return "配置状态：" + notice
}
