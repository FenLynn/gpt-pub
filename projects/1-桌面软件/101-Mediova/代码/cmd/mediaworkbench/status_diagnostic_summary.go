package main

import (
	"fmt"
	"sort"
	"strings"
)

var diagnosticStatusCategoryTokens = []struct {
	Name   string
	Tokens []string
}{
	{Name: "Runtime", Tokens: []string{"runtime", "ffmpeg 组件目录", "ffmpeg 可继续使用"}},
	{Name: "配置", Tokens: []string{"配置提醒", "配置状态", "配置保存", "配置主文件", "config.json"}},
	{Name: "会话", Tokens: []string{"任务会话", "会话快照", "session.json"}},
	{Name: "历史", Tokens: []string{"历史记录", "history.json"}},
	{Name: "数据目录", Tokens: []string{"数据目录", "目录权限", "磁盘空间", "安全软件占用"}},
	{Name: "便携模式", Tokens: []string{"便携模式数据", "普通模式数据", "目标旧数据已备份", "mode-switch"}},
}

func normalizeDiagnosticStatusText(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func diagnosticStatusCategories(value string) []string {
	value = strings.ToLower(normalizeDiagnosticStatusText(value))
	if value == "" {
		return nil
	}
	var categories []string
	for _, category := range diagnosticStatusCategoryTokens {
		matched := false
		for _, token := range category.Tokens {
			if strings.Contains(value, strings.ToLower(token)) {
				matched = true
				break
			}
		}
		if matched {
			categories = append(categories, category.Name)
		}
	}
	sort.Strings(categories)
	return categories
}

func diagnosticStatusSeverity(value string) string {
	value = strings.ToLower(normalizeDiagnosticStatusText(value))
	for _, token := range []string{
		"失败", "错误", "异常", "损坏", "不可写", "不可用", "只读", "未能", "无法", "警告", "提醒",
	} {
		if strings.Contains(value, strings.ToLower(token)) {
			return "warning"
		}
	}
	return "info"
}

func isDiagnosticStatusText(value string) bool {
	value = normalizeDiagnosticStatusText(value)
	if value == "" {
		return false
	}
	if strings.HasPrefix(value, "配置提醒：") || strings.HasPrefix(value, "配置状态：") {
		return true
	}
	return len(diagnosticStatusCategories(value)) > 0
}

func diagnosticStatusRuneBudget(width int32) int {
	// Microsoft YaHei UI at the current footer size averages about 8–9 logical
	// pixels per Chinese character. Keep a safety margin for DPI rounding.
	budget := int(width / 10)
	if budget < 8 {
		budget = 8
	}
	if budget > 58 {
		budget = 58
	}
	return budget
}

func trimDiagnosticStatusRunes(value string, budget int) string {
	value = normalizeDiagnosticStatusText(value)
	runes := []rune(value)
	if budget <= 0 || len(runes) <= budget {
		return value
	}
	if budget <= 1 {
		return "…"
	}
	return string(runes[:budget-1]) + "…"
}

func diagnosticStatusSummary(value string, width int32) string {
	value = normalizeDiagnosticStatusText(value)
	if !isDiagnosticStatusText(value) {
		return value
	}
	categories := diagnosticStatusCategories(value)
	severity := diagnosticStatusSeverity(value)
	label := "状态"
	if severity == "warning" {
		label = "提醒"
	}
	budget := diagnosticStatusRuneBudget(width)

	var summary string
	switch {
	case budget <= 14:
		if len(categories) > 1 {
			summary = fmt.Sprintf("%d项%s · 详情", len(categories), label)
		} else {
			summary = label + " · 详情"
		}
	case budget <= 26:
		if len(categories) > 1 {
			summary = fmt.Sprintf("检测到%d项%s · 查看详情", len(categories), label)
		} else if len(categories) == 1 {
			summary = categories[0] + label + " · 查看详情"
		} else {
			summary = label + " · 查看详情"
		}
	default:
		categoryText := "运行环境"
		if len(categories) > 0 {
			visible := categories
			if len(visible) > 3 {
				visible = visible[:3]
			}
			categoryText = strings.Join(visible, "、")
			if len(categories) > len(visible) {
				categoryText += fmt.Sprintf("等%d项", len(categories))
			}
		}
		summary = categoryText + label + " · 点击查看详情"
	}
	return trimDiagnosticStatusRunes(summary, budget)
}

func diagnosticStatusDetailText(value string) string {
	value = normalizeDiagnosticStatusText(value)
	if value == "" {
		return "当前没有运行环境或持久化诊断信息。"
	}
	return value + "\r\n\r\n可通过“帮助 → 诊断报告”生成包含配置、任务快照和完整运行状态的诊断文件。"
}
