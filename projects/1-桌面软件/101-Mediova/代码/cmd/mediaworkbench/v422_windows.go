//go:build windows

package main

import (
	"fmt"
	"strings"
	"time"

	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
)

// drawStatusLamp uses a font-rendered vector glyph rather than a tiny GDI
// ellipse. Windows applies font antialiasing at every DPI, so the four status
// indicators remain round and crisp on 100%-200% displays.
func drawStatusLamp(hdc uintptr, rc rect, color uintptr) {
	lamp := rect{
		Left:   rc.Left + scaleDPI(2),
		Top:    rc.Top,
		Right:  rc.Left + scaleDPI(23),
		Bottom: rc.Bottom,
	}
	drawCenteredText(hdc, "●", lamp, uiFontTitle, color)
}

func drawCompactResetGlyph(hdc uintptr, rc rect, color uintptr) {
	cx := rc.Left + scaleDPI(15)
	cy := (rc.Top + rc.Bottom) / 2
	radius := scaleDPI(4)
	pen, _, _ := procCreatePen.Call(PS_SOLID, 1, color)
	oldPen, _, _ := procSelectObject.Call(hdc, pen)
	hollow, _, _ := procGetStockObject.Call(NULL_BRUSH)
	oldBrush, _, _ := procSelectObject.Call(hdc, hollow)
	procEllipse.Call(hdc, uintptr(cx-radius), uintptr(cy-radius), uintptr(cx+radius), uintptr(cy+radius))
	drawGDIline(hdc, cx+radius-1, cy-radius, cx+radius+3, cy-radius)
	drawGDIline(hdc, cx+radius+3, cy-radius, cx+radius+3, cy-radius+4)
	procSelectObject.Call(hdc, oldBrush)
	procSelectObject.Call(hdc, oldPen)
	procDeleteObject.Call(pen)
}

// drawContrastCenteredText paints dark text over the unfilled track and then
// repaints only the filled part in white. A percentage straddling the fill
// boundary therefore remains readable on both sides, matching the original UI.
func drawContrastCenteredText(hdc uintptr, text string, bar, fill rect, font uintptr) {
	drawCenteredText(hdc, text, bar, font, colorRef(35, 51, 74))
	if fill.Right <= fill.Left || fill.Bottom <= fill.Top {
		return
	}
	if fill.Left < bar.Left {
		fill.Left = bar.Left
	}
	if fill.Right > bar.Right {
		fill.Right = bar.Right
	}
	withRoundedClip(hdc, fill, 1, func() {
		drawCenteredText(hdc, text, bar, font, colorRef(255, 255, 255))
	})
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

func (summary v422ProgressSummary) render(kind model.Kind, running bool, start time.Time, paused, showStats bool) (float64, string, time.Duration, time.Duration, string) {
	pct := 0.0
	if summary.Total > 0 {
		pct = summary.Sum / float64(summary.Total)
	}
	pct = clamp01(pct/100) * 100
	text := fmt.Sprintf("已完成 %d/%d · 总进度 %.1f%%", summary.Completed, summary.Total, pct)
	var elapsed, remaining time.Duration
	speed := "—"
	if running {
		if !start.IsZero() {
			elapsed = time.Since(start)
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
