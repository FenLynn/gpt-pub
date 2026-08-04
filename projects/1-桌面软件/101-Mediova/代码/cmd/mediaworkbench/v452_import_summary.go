package main

import "strings"

// v452ImportFeedbackText recognises all import entry-point summaries and gives
// the direct-file path the same concise wording as folder and drag imports.
func v452ImportFeedbackText(text string) (string, bool) {
	text = strings.TrimSpace(text)
	switch {
	case strings.HasPrefix(text, "导入完成："):
		return text, true
	case strings.HasPrefix(text, "已自动分流："):
		text = strings.TrimPrefix(text, "已自动分流：")
		if cut := strings.Index(text, "；"); cut >= 0 {
			text = text[:cut]
		}
		return "导入完成：" + strings.TrimSpace(text), true
	case strings.HasPrefix(text, "未加入新文件"),
		strings.HasPrefix(text, "未发现可导入"),
		strings.HasPrefix(text, "拖拽导入失败"),
		strings.HasPrefix(text, "未从拖拽内容中读取到文件"):
		return text, true
	default:
		return "", false
	}
}
