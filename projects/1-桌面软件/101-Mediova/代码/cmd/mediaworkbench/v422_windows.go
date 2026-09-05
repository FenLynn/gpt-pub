//go:build windows

package main

import (
	"fmt"
	"strings"
	"time"
	"unsafe"

	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
)

// drawStatusLamp uses an explicitly square GDI ellipse. Its diameter is
// derived from the status text height and remains circular at every DPI.
func drawStatusLamp(hdc uintptr, rc rect, color uintptr) {
	v452DrawTrueStatusLamp(hdc, rc, color)
}

func drawCompactResetGlyph(hdc uintptr, rc rect, color uintptr) {
	icon := rc
	icon.Right = icon.Left + scaleDPI(30)
	drawCenteredText(hdc, "\uE72C", icon, iconFont, color)
}

// drawContrastCenteredText measures the complete label, keeps it centred, and
// paints every glyph according to the background under its centre. This avoids
// ListView/PrintWindow clipping inconsistencies while preserving white text on
// blue fill and dark text on the light remainder of partially filled bars.
func drawContrastCenteredText(hdc uintptr, text string, bar, fill rect, font uintptr) {
	if text == "" {
		return
	}
	oldFont, _, _ := procSelectObject.Call(hdc, font)
	defer func() {
		if oldFont != 0 {
			procSelectObject.Call(hdc, oldFont)
		}
	}()
	procSetBkMode.Call(hdc, TRANSPARENT)

	units := []rune(text)
	widths := make([]int32, len(units))
	var total int32
	for i, unit := range units {
		measure := rect{Right: 32767, Bottom: bar.Bottom - bar.Top}
		unitText := string(unit)
		procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(unitText))), ^uintptr(0), uintptr(unsafe.Pointer(&measure)), DT_LEFT|DT_SINGLELINE|DT_CALCRECT)
		width := measure.Right - measure.Left
		if width <= 0 {
			width = scaleDPI(8)
		}
		widths[i] = width
		total += width
	}

	x := bar.Left + (bar.Right-bar.Left-total)/2
	dark := colorRef(35, 51, 74)
	light := colorRef(255, 255, 255)
	for i, unit := range units {
		width := widths[i]
		colour := dark
		centre := x + width/2
		if fill.Right > fill.Left && centre >= fill.Left && centre <= fill.Right {
			colour = light
		}
		procSetTextColor.Call(hdc, colour)
		unitRC := rect{Left: x, Top: bar.Top, Right: x + width + 1, Bottom: bar.Bottom}
		unitText := string(unit)
		procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(unitText))), ^uintptr(0), uintptr(unsafe.Pointer(&unitRC)), DT_LEFT|DT_VCENTER|DT_SINGLELINE)
		x += width
	}
}

func taskDurationText(task *model.Task) string {
	if task == nil || task.Kind == model.KindImage {
		return "—"
	}
	if task.Duration <= 0 {
		return "检测中"
	}
	return formatDuration(time.Duration(task.Duration * float64(time.Second)))
}

func queueStartLabel(kind model.Kind) string {
	if kind == model.KindImage {
		return "开始压缩"
	}
	return "开始转换"
}

func queuePauseLabel(kind model.Kind, paused bool) string {
	if kind == model.KindImage {
		if paused {
			return "继续压缩"
		}
		return "暂停压缩"
	}
	if paused {
		return "继续转换"
	}
	return "暂停转换"
}

func queueStopLabel(kind model.Kind) string {
	if kind == model.KindImage {
		return "停止压缩"
	}
	return "停止转换"
}

func waitingQueueLabel(runKind model.Kind) string {
	if runKind == model.KindImage {
		return "等待图片队列"
	}
	return "等待视频队列"
}

type v422ProgressSummary struct {
	Total           int
	Completed       int
	Failed          int
	Active          int
	Sum             float64
	ProcessedVideo  float64
	ProcessedImages float64
	TotalInput      int64
	TotalOutput     int64
	Engine          string
}

func (a *application) v422SummarizeProgress(kind model.Kind, only map[int64]bool) v422ProgressSummary {
	var summary v422ProgressSummary
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, task := range a.tasks {
		if task == nil || task.Kind != kind || (only != nil && !only[task.ID]) {
			continue
		}
		summary.Total++
		summary.Sum += task.Progress
		summary.TotalInput += task.InputSize
		if task.Status == model.StatusDone {
			summary.TotalOutput += task.OutputSize
		}
		if kind == model.KindVideo && task.Duration > 0 {
			summary.ProcessedVideo += task.Duration * task.Progress / 100
		}
		if kind == model.KindImage {
			summary.ProcessedImages += task.Progress / 100
		}
		switch task.Status {
		case model.StatusDone, model.StatusSkipped:
			summary.Completed++
		case model.StatusFailed:
			summary.Failed++
		case model.StatusProcessing, model.StatusPaused:
			summary.Active++
			low := strings.ToLower(task.Engine)
			if strings.Contains(low, "copy") || strings.Contains(task.Engine, "复制") {
				summary.Engine = "直接复制"
			} else if strings.Contains(low, "nvenc") || strings.Contains(low, "qsv") || strings.Contains(low, "amf") || strings.Contains(task.Engine, "GPU") {
				summary.Engine = "GPU"
			} else if summary.Engine == "" {
				summary.Engine = "CPU"
			}
		}
	}
	return summary
}

func (summary v422ProgressSummary) render(kind model.Kind, running bool, elapsed time.Duration, paused, showStats bool) (float64, string, time.Duration, time.Duration, string) {
	pct := 0.0
	if summary.Total > 0 {
		pct = summary.Sum / float64(summary.Total)
	}
	pct = clamp01(pct/100) * 100
	text := fmt.Sprintf("已完成 %d/%d · 总进度 %.1f%%", summary.Completed, summary.Total, pct)
	var remaining time.Duration
	speed := "—"
	if running {
		if elapsed < 0 {
			elapsed = 0
		}
		text += " · 已用 " + formatDuration(elapsed)
		if pct > .2 && pct < 100 && elapsed > 0 {
			estimate := time.Duration(float64(elapsed) * 100 / pct)
			remaining = estimate - elapsed
			if remaining > 0 {
				text += " · 剩余 " + formatDuration(remaining)
			}
		}
		if elapsed.Seconds() > 0 {
			if kind == model.KindVideo {
				speed = fmt.Sprintf("%.2fx", summary.ProcessedVideo/elapsed.Seconds())
			} else if elapsed.Minutes() > 0 {
				speed = fmt.Sprintf("%.0f 张/分", summary.ProcessedImages/elapsed.Minutes())
			}
		}
		if showStats {
			text += " · 速度 " + speed
			if summary.TotalInput > 0 {
				text += " · " + media.FormatBytes(summary.TotalInput) + " → " + media.FormatBytes(summary.TotalOutput)
			}
		}
		if paused {
			text += " · 已暂停"
		}
	}
	if summary.Failed > 0 {
		text += fmt.Sprintf(" · 失败 %d", summary.Failed)
	}
	return pct, text, elapsed, remaining, speed
}
