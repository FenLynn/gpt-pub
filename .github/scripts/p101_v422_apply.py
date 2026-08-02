from __future__ import annotations

import hashlib
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path.cwd()
PROJECT = ROOT / "projects/1-桌面软件/101-Mediova"
CODE = PROJECT / "代码"
CMD = CODE / "cmd/mediaworkbench"
MAIN = CMD / "main_windows.go"
UI_RULES = CMD / "ui_rules.go"
UI_TESTS = CMD / "ui_rules_test.go"
V420 = CMD / "v420_windows.go"
V420_HARDEN = CMD / "v420_harden_windows.go"
SAFETY = CMD / "windows_safety_test.go"
CONTRACT_OLD = CMD / "v421_source_contract_test.go"
CONTRACT_NEW = CMD / "v422_source_contract_test.go"
HELPER = CMD / "v422_windows.go"
HELPER_TEST = CMD / "v422_windows_test.go"
HASHES = CODE / "SOURCE_FILES_SHA256.txt"
BUILD_OLD = CODE / "build_v4.2.1.ps1"
BUILD_NEW = CODE / "build_v4.2.2.ps1"
WORK = PROJECT / "工作记录.md"
RULES = PROJECT / "开发约束.md"
NOTES = PROJECT / "Mediova_v4.2.2_版本说明.md"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def replace_regex(text: str, pattern: str, replacement: str, label: str, flags: int = re.S) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{label}: expected one regex match, found {count}")
    return updated


helper = r'''//go:build windows

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
    pct = clamp01(pct / 100) * 100
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
'''
write(HELPER, helper)

helper_test = r'''//go:build windows

package main

import (
    "testing"

    "mediaworkbench/internal/model"
)

func TestV422DurationColumnText(t *testing.T) {
    if got := taskDurationText(&model.Task{Kind: model.KindVideo, Duration: 65.4}); got != "01:05" {
        t.Fatalf("video duration=%q", got)
    }
    if got := taskDurationText(&model.Task{Kind: model.KindImage, Duration: 65.4}); got != "—" {
        t.Fatalf("image duration=%q", got)
    }
    if got := taskDurationText(&model.Task{Kind: model.KindVideo}); got != "检测中" {
        t.Fatalf("unknown duration=%q", got)
    }
}

func TestV422QueueLabelsAreMediaSpecific(t *testing.T) {
    if queueStartLabel(model.KindImage) != "开始压缩" || queuePauseLabel(model.KindImage, false) != "暂停压缩" || queueStopLabel(model.KindImage) != "停止压缩" {
        t.Fatal("image queue labels are not independent")
    }
    if queueStartLabel(model.KindVideo) != "开始转换" || queuePauseLabel(model.KindVideo, true) != "继续转换" || queueStopLabel(model.KindVideo) != "停止转换" {
        t.Fatal("video queue labels are not independent")
    }
    if waitingQueueLabel(model.KindVideo) != "等待视频队列" || waitingQueueLabel(model.KindImage) != "等待图片队列" {
        t.Fatal("waiting queue label mismatch")
    }
}
'''
write(HELPER_TEST, helper_test)

ui_rules = read(UI_RULES)
ui_rules = replace_once(
    ui_rules,
    'import "strings"',
    'import (\n\t"strings"\n\n\t"mediaworkbench/internal/model"\n)',
    "ui_rules imports",
)
ui_rules = replace_regex(
    ui_rules,
    r'func bottomParameterWidths\(\) parameterWidthSet \{\n\treturn parameterWidthSet\{Resolution: 84, Codec: 78, Quality: 72, Volume: 126, Rotation: 98\}\n\}',
    '''func bottomParameterWidths(kind model.Kind) parameterWidthSet {
\tif kind == model.KindImage {
\t\t// Image size labels are the longest. Format, quality and target-size
\t\t// choices are deliberately compact so “最大边 1000px” is never clipped.
\t\treturn parameterWidthSet{Resolution: 122, Codec: 60, Quality: 58, Volume: 82, Rotation: 88}
\t}
\treturn parameterWidthSet{Resolution: 84, Codec: 78, Quality: 72, Volume: 126, Rotation: 98}
}''',
    "media-specific bottom widths",
    flags=0,
)
write(UI_RULES, ui_rules)

ui_tests = read(UI_TESTS)
ui_tests = replace_once(ui_tests, '"reflect"\n\t"testing"', '"reflect"\n\t"testing"\n\n\t"mediaworkbench/internal/model"', "ui test imports")
ui_tests = replace_regex(
    ui_tests,
    r'func TestBottomParameterWidthsArePurposeSized\(t \*testing\.T\) \{.*?\n\}',
    '''func TestBottomParameterWidthsArePurposeSized(t *testing.T) {
\tvideo := bottomParameterWidths(model.KindVideo)
\timage := bottomParameterWidths(model.KindImage)
\tif video.Resolution >= video.Volume || video.Quality <= 68 || video.Codec >= video.Rotation {
\t\tt.Fatalf("unexpected video widths=%+v", video)
\t}
\tif image.Resolution <= video.Resolution || image.Resolution <= image.Volume || image.Codec >= video.Codec || image.Quality >= video.Quality || image.Volume >= video.Volume {
\t\tt.Fatalf("image controls are not purpose-sized: video=%+v image=%+v", video, image)
\t}
\tif image.Resolution < 116 || image.Volume > 88 || image.Quality > 62 {
\t\tt.Fatalf("image bottom widths remain unbalanced: %+v", image)
\t}
}''',
    "bottom width tests",
)
write(UI_TESTS, ui_tests)

main = read(MAIN)
main = replace_once(main, 'const appVersion = "4.2.1"', 'const appVersion = "4.2.2"', "app version")
main = replace_regex(
    main,
    r'var taskListColumns = \[\]struct \{.*?\n\}\n\nfunc normalizedTaskColumnWidths\(widths \[\]int\) \[\]int \{.*?\n\}',
    '''var taskListColumns = []struct {
\tname  string
\twidth int
}{
\t// “时长” is a video-only value; image rows display an em dash so both
\t// workspaces retain one stable column model and saved widths remain portable.
\t{"文件 / 预览", 280}, {"分辨率", 100}, {"时长", 76}, {"方向", 70}, {"输出分辨率", 116}, {"质量", 58},
\t{"旋转", 90}, {"体积", 92}, {"压缩后", 140}, {"进度", 105}, {"状态", 124},
}

func normalizedTaskColumnWidths(widths []int) []int {
\t// v4.2.1 stored ten widths. Insert the new duration width after resolution
\t// before validating values, otherwise every later saved width shifts columns.
\tsource := widths
\tif len(widths) == 10 {
\t\tmigrated := make([]int, 0, len(taskListColumns))
\t\tmigrated = append(migrated, widths[:2]...)
\t\tmigrated = append(migrated, taskListColumns[2].width)
\t\tmigrated = append(migrated, widths[2:]...)
\t\tsource = migrated
\t}
\tresult := make([]int, len(taskListColumns))
\tfor i, column := range taskListColumns {
\t\twidth := column.width
\t\tif i < len(source) && source[i] >= 45 && source[i] <= 900 {
\t\t\twidth = source[i]
\t\t}
\t\tresult[i] = width
\t}
\treturn result
}''',
    "task columns and migration",
)

# Adjust column width distribution for the inserted duration column.
distribution_match = re.search(r'func distributeDefaultTaskColumns\(listW int32\) \[\]int \{.*?\n\}\n\ntype topBand', main, re.S)
if not distribution_match:
    raise RuntimeError("column distribution function missing")
distribution = distribution_match.group(0)
distribution = replace_once(distribution, 'widths[7] += compression', 'widths[8] += compression', "compression distribution index")
distribution = replace_once(distribution, 'widths[9] += status', 'widths[10] += status', "status distribution index")
distribution = replace_once(
    distribution,
    '[]struct{ idx, min int }{{0, 210}, {9, 88}, {7, 112}, {8, 86}, {3, 92}, {1, 84}}',
    '[]struct{ idx, min int }{{0, 190}, {10, 88}, {8, 112}, {9, 86}, {4, 92}, {1, 84}, {2, 68}}',
    "column shrink order",
)
main = main[: distribution_match.start()] + distribution + main[distribution_match.end() :]
main = replace_once(main, 'bottomWidths := bottomParameterWidths()', 'bottomWidths := bottomParameterWidths(a.currentKind)', "layout uses media widths")

# Replace the tiny GDI ellipse with the font-antialiased vector lamp.
main = replace_regex(
    main,
    r'\tdiameter := scaleDPI\(14\).*?\tprocDeleteObject\.Call\(brush\)\n',
    '\tdrawStatusLamp(dis.HDC, rc, dot)\n',
    "status lamp drawing",
)
status_match = re.search(r'func \(a \*application\) drawStatusChip\(dis \*drawItemStruct\) bool \{.*?\n\}', main, re.S)
if not status_match:
    raise RuntimeError("drawStatusChip missing")
status_func = status_match.group(0)
status_func = replace_once(status_func, 'textRC.Left += scaleDPI(22)', 'textRC.Left += scaleDPI(24)', "status text inset")
main = main[: status_match.start()] + status_func + main[status_match.end() :]

main = replace_once(main, '\tcase app.hAllDefault:\n\t\treturn "\\uE72C" // Refresh / restore defaults\n', '', "remove oversized reset font glyph")
main = replace_once(
    main,
    '''\tglyph := secondaryButtonGlyph(dis.HwndItem)
\ttextRC := rc
\tif glyph != "" && rc.Right-rc.Left >= 72 {
\t\ticonRC := rc
\t\ticonRC.Left += 7
\t\ticonRC.Right = iconRC.Left + 19
\t\tdrawCenteredText(dis.HDC, glyph, iconRC, iconFont, textColor)
\t\ttextRC.Left += 19
\t}
\tdrawCenteredText(dis.HDC, label, textRC, uiFontSmall, textColor)''',
    '''\tglyph := secondaryButtonGlyph(dis.HwndItem)
\ttextRC := rc
\tif dis.HwndItem == a.hAllDefault {
\t\tdrawCompactResetGlyph(dis.HDC, rc, textColor)
\t\ttextRC.Left += scaleDPI(20)
\t} else if glyph != "" && rc.Right-rc.Left >= 72 {
\t\ticonRC := rc
\t\ticonRC.Left += 7
\t\ticonRC.Right = iconRC.Left + 19
\t\tdrawCenteredText(dis.HDC, glyph, iconRC, iconFont, textColor)
\t\ttextRC.Left += 19
\t}
\tdrawCenteredText(dis.HDC, label, textRC, uiFontSmall, textColor)''',
    "compact reset glyph",
)

main = replace_regex(
    main,
    r'func drawProgressPill\(hdc uintptr, rc rect, fraction float64, label string, selected, active bool\) \{.*?\n\}\n\nfunc compressionColorPair',
    '''func drawProgressPill(hdc uintptr, rc rect, fraction float64, label string, selected, active bool) {
\tif selected {
\t\tif active {
\t\t\tbrush, _, _ := procGetSysColorBrush.Call(COLOR_HIGHLIGHT)
\t\t\tprocFillRect.Call(hdc, uintptr(unsafe.Pointer(&rc)), brush)
\t\t} else {
\t\t\tfillSolid(hdc, rc, colorRef(240, 244, 249))
\t\t}
\t} else {
\t\tfillSolid(hdc, rc, colorRef(255, 255, 255))
\t}
\tfraction = clamp01(fraction)
\tbar := fullCellBarRect(rc)
\tfillSolid(hdc, bar, colorRef(239, 243, 248))
\tfill := rect{Left: bar.Left, Top: bar.Top, Right: bar.Left, Bottom: bar.Bottom}
\tif fraction > 0 {
\t\tfill = bar
\t\tfill.Right = fill.Left + int32(float64(fill.Right-fill.Left)*fraction)
\t\tif fill.Right < fill.Left+3 {
\t\t\tfill.Right = fill.Left + 3
\t\t}
\t\tdrawHorizontalGradient(hdc, fill, colorRef(169, 204, 243), colorRef(76, 138, 220))
\t}
\tdrawRoundedBorder(hdc, bar, 3, colorRef(218, 225, 234))
\tdrawContrastCenteredText(hdc, label, bar, fill, uiFontSmall)
}

func compressionColorPair''',
    "row progress contrast",
)
main = replace_once(main, 'fillSolid(hdc, left, colorRef(247, 249, 251))', 'fillSolid(hdc, left, colorRef(228, 233, 239))', "compression left grey")

main = replace_regex(
    main,
    r'func \(a \*application\) drawOverallProgress\(dis \*drawItemStruct\) bool \{.*?\n\}\n\nfunc \(a \*application\) drawDecoration',
    '''func (a *application) drawOverallProgress(dis *drawItemStruct) bool {
\tif dis == nil || dis.HwndItem != a.hProgress {
\t\treturn false
\t}
\trc := dis.RcItem
\tbar := rect{Left: rc.Left + 1, Top: rc.Top + 2, Right: rc.Right - 1, Bottom: rc.Bottom - 2}
\tfraction := clamp01(a.overallProgress / 100)
\tfill := rect{Left: bar.Left, Top: bar.Top, Right: bar.Left, Bottom: bar.Bottom}
\twithRoundedClip(dis.HDC, bar, 4, func() {
\t\tfillSolid(dis.HDC, bar, colorRef(248, 250, 252))
\t\tif fraction > 0 {
\t\t\tfill = bar
\t\t\tfill.Right = fill.Left + int32(float64(fill.Right-fill.Left)*fraction)
\t\t\tif fill.Right < fill.Left+4 {
\t\t\t\tfill.Right = fill.Left + 4
\t\t\t}
\t\t\tif a.overallPaused {
\t\t\t\tdrawHorizontalGradient(dis.HDC, fill, colorRef(255, 229, 178), colorRef(225, 157, 43))
\t\t\t} else {
\t\t\t\tdrawHorizontalGradient(dis.HDC, fill, colorRef(151, 196, 245), colorRef(58, 122, 214))
\t\t\t}
\t\t}
\t})
\tdrawContrastCenteredText(dis.HDC, a.overallText, bar, fill, uiFontSmall)
\treturn true
}

func (a *application) drawDecoration''',
    "overall progress contrast",
)

main = replace_regex(
    main,
    r'func \(a \*application\) switchKind\(kind model\.Kind\) \{.*?\n\}',
    '''func (a *application) switchKind(kind model.Kind) {
\ta.currentKind = kind
\ta.writeSettingsToUI()
\ta.refreshList()
\ta.updateRightPanel()
\ta.v420UpdateStartAction()
\ta.refreshTotal()
\tvar client rect
\tif ok, _, _ := procGetClientRect.Call(a.hwnd, uintptr(unsafe.Pointer(&client))); ok != 0 {
\t\ta.layout(client.Right-client.Left, client.Bottom-client.Top)
\t}
\tfor _, h := range []uintptr{a.hVideo, a.hImage} {
\t\tprocInvalidateRect.Call(h, 0, 1)
\t}
}''',
    "workspace switch refresh",
)

# Shift custom-draw indices by one after the new duration column.
draw_match = re.search(r'func \(a \*application\) drawTaskListCell\(cd \*nmListViewCustomDraw\) uintptr \{.*?\n\}', main, re.S)
if not draw_match:
    raise RuntimeError("drawTaskListCell missing")
draw_func = draw_match.group(0)
draw_func = replace_once(draw_func, 'cd.ISubItem != 7 && cd.ISubItem != 8 && cd.ISubItem != 9', 'cd.ISubItem != 8 && cd.ISubItem != 9 && cd.ISubItem != 10', "custom draw accepted columns")
draw_func = replace_once(draw_func, 'if cd.ISubItem == 7 {', 'if cd.ISubItem == 8 {', "compression custom column")
draw_func = replace_once(draw_func, 'if cd.ISubItem == 8 {', 'if cd.ISubItem == 9 {', "progress custom column")
draw_func = replace_once(draw_func, 'a.taskTexts(&task)[9]', 'a.taskTexts(&task)[10]', "status custom column")
main = main[: draw_match.start()] + draw_func + main[draw_match.end() :]

main = replace_regex(
    main,
    r'func \(a \*application\) taskTexts\(t \*model\.Task\) \[\]string \{.*?\n\}\nfunc \(a \*application\) outputResolutionText',
    '''func (a *application) taskTexts(t *model.Task) []string {
\tspec := "检测中"
\tif t.Width > 0 {
\t\tspec = fmt.Sprintf("%d×%d", t.Width, t.Height)
\t}
\tdir := "0°"
\tif t.Rotation != 0 {
\t\tdir = fmt.Sprintf("%d°", t.Rotation)
\t}
\topts := a.settings.EffectiveOptions(t)
\toutRes := a.outputResolutionText(t, opts)
\tcompressed := "—"
\tif t.OutputSize > 0 {
\t\tratio := ""
\t\tif t.InputSize > 0 {
\t\t\tratio = fmt.Sprintf(" (%.1f%%)", float64(t.OutputSize)/float64(t.InputSize)*100)
\t\t}
\t\tcompressed = media.FormatBytes(t.OutputSize) + ratio
\t}
\tstatus := string(t.Status)
\tif t.Status == model.StatusProcessing && t.Progress > .5 && !t.StartedAt.IsZero() {
\t\telapsed := time.Since(t.StartedAt)
\t\tremain := time.Duration(float64(elapsed) * (100 - t.Progress) / t.Progress)
\t\tif remain > 0 && remain < 7*24*time.Hour {
\t\t\tstatus = "剩余 " + formatDuration(remain)
\t\t}
\t}
\tif t.Error != "" {
\t\tif t.FailureCategory != "" {
\t\t\tstatus += " · " + t.FailureCategory
\t\t}
\t\tstatus += " · " + short(t.Error, 45)
\t} else if t.ValidationWarning != "" {
\t\tstatus += " · 校验警告"
\t}
\tname := filepath.Base(t.Input)
\tif t.Pinned {
\t\tname = "[置顶] " + name
\t}
\treturn []string{name, spec, taskDurationText(t), dir, outRes, opts.Quality, opts.Rotation, media.FormatBytes(t.InputSize), compressed, fmt.Sprintf("%.1f%%", t.Progress), status}
}
func (a *application) outputResolutionText''',
    "task text duration column",
)

main = replace_regex(
    main,
    r'func compareTaskColumn\(left, right \*model\.Task, column int\) int \{.*?\n\}\n\nfunc taskSortLabel\(column int\) string \{.*?\n\}\n\nfunc \(a \*application\) toggleTaskSort\(column int\) \{.*?\n\}',
    '''func compareTaskColumn(left, right *model.Task, column int) int {
\tif left == nil && right == nil { return 0 }
\tif left == nil { return 1 }
\tif right == nil { return -1 }
\tcmpString := func(a, b string) int { return strings.Compare(strings.ToLower(a), strings.ToLower(b)) }
\tcmpInt64 := func(a, b int64) int { if a < b { return -1 }; if a > b { return 1 }; return 0 }
\tcmpFloat := func(a, b float64) int { if a < b { return -1 }; if a > b { return 1 }; return 0 }
\tswitch column {
\tcase 0:
\t\treturn cmpString(filepath.Base(left.Input), filepath.Base(right.Input))
\tcase 1:
\t\tif left.Width != right.Width { return cmpInt64(int64(left.Width), int64(right.Width)) }
\t\treturn cmpInt64(int64(left.Height), int64(right.Height))
\tcase 2:
\t\treturn cmpFloat(left.Duration, right.Duration)
\tcase 3:
\t\treturn cmpInt64(int64(left.Rotation), int64(right.Rotation))
\tcase 4:
\t\treturn cmpString(left.Options.Resolution+left.Options.ImageSize, right.Options.Resolution+right.Options.ImageSize)
\tcase 5:
\t\treturn cmpString(left.Options.Quality, right.Options.Quality)
\tcase 6:
\t\treturn cmpString(left.Options.Rotation, right.Options.Rotation)
\tcase 7:
\t\treturn cmpInt64(left.InputSize, right.InputSize)
\tcase 8:
\t\treturn cmpInt64(left.OutputSize, right.OutputSize)
\tcase 9:
\t\treturn cmpFloat(left.Progress, right.Progress)
\tcase 10:
\t\treturn cmpInt64(int64(taskStatusRank(left.Status)), int64(taskStatusRank(right.Status)))
\tdefault:
\t\treturn cmpInt64(left.ID, right.ID)
\t}
}

func taskSortLabel(column int) string {
\tlabels := []string{"文件名", "分辨率", "时长", "方向", "输出分辨率", "质量", "旋转", "源体积", "输出体积", "进度", "状态"}
\tif column >= 0 && column < len(labels) { return labels[column] }
\treturn "任务"
}

func (a *application) toggleTaskSort(column int) {
\tif column < 0 || column >= len(taskListColumns) { return }
\tif a.sortActive && a.sortColumn == column {
\t\ta.sortDescending = !a.sortDescending
\t} else {
\t\ta.sortActive = true
\t\ta.sortColumn = column
\t\ta.sortDescending = false
\t}
\ta.refreshList()
\tdirection := "升序"
\tif a.sortDescending { direction = "降序" }
\tsetText(a.hStatusText, fmt.Sprintf("任务列表已按%s%s排列；再次点击同一表头可反向。", taskSortLabel(column), direction))
}''',
    "task sorting with duration",
)

main = replace_regex(
    main,
    r'func \(a \*application\) refreshTotal\(\) \{.*?\n\}\n\nfunc prepareTaskForRetry',
    '''func (a *application) refreshTotal() {
\ta.runMu.Lock()
\trunning := a.running
\tpaused := a.paused
\tstart := a.runStart
\trunKind := a.runKind
\trunIDs := copyTaskIDSet(a.runTaskIDs)
\ta.runMu.Unlock()

\tdisplayKind := a.currentKind
\tdisplayRunning := running && displayKind == runKind
\tvar displayIDs map[int64]bool
\tif displayRunning { displayIDs = runIDs }
\tdisplay := a.v422SummarizeProgress(displayKind, displayIDs)
\tpct, text, elapsed, remaining, speed := display.render(displayKind, displayRunning, start, displayRunning && paused, a.settings.ShowPerformanceStats)
\ta.overallProgress = pct
\ta.overallText = text
\ta.overallPaused = displayRunning && paused
\tprocInvalidateRect.Call(a.hProgress, 0, 1)

\tif running {
\t\trunSummary := display
\t\tif !displayRunning { runSummary = a.v422SummarizeProgress(runKind, runIDs) }
\t\trunPct, _, runElapsed, runRemaining, runSpeed := runSummary.render(runKind, true, start, paused, a.settings.ShowPerformanceStats)
\t\ta.updateFloatingBar(runPct, floatingProgressText(runPct, runSummary.Completed, runSummary.Total, runElapsed, runRemaining, runSpeed, runSummary.Active, runSummary.Engine, paused), true)
\t} else {
\t\ta.updateFloatingBar(pct, floatingProgressText(pct, display.Completed, display.Total, elapsed, remaining, speed, display.Active, display.Engine, false), false)
\t}
}

func prepareTaskForRetry''',
    "independent workspace progress",
)

# Self-test custom-draw columns moved by one.
main = replace_once(main, 'compressionCell, compressionOK := listSubItemBounds(a.hList, 0, 7)', 'compressionCell, compressionOK := listSubItemBounds(a.hList, 0, 8)', "self-test compression column")
main = replace_once(main, 'progressCell, progressOK := listSubItemBounds(a.hList, 0, 8)', 'progressCell, progressOK := listSubItemBounds(a.hList, 0, 9)', "self-test progress column")
write(MAIN, main)

v420 = read(V420)
v420 = replace_regex(
    v420,
    r'func \(a \*application\) v420UpdateStartAction\(\) \{.*?\n\}',
    '''func (a *application) v420UpdateStartAction() {
\tif a == nil || a.hStart == 0 { return }
\ta.runMu.Lock()
\trunning, runKind, paused := a.running, a.runKind, a.paused
\ta.runMu.Unlock()
\tready := a.v420ReadyCount(a.currentKind)
\townsRun := running && a.currentKind == runKind
\tenable(a.hPause, ownsRun)
\tenable(a.hStop, ownsRun)
\tsetText(a.hPause, queuePauseLabel(a.currentKind, ownsRun && paused))
\tsetText(a.hStop, queueStopLabel(a.currentKind))
\tif running {
\t\tif ownsRun {
\t\t\tsetText(a.hStart, "加入队列")
\t\t\tenable(a.hStart, ready > 0)
\t\t} else {
\t\t\tsetText(a.hStart, waitingQueueLabel(runKind))
\t\t\tenable(a.hStart, false)
\t\t}
\t\treturn
\t}
\tsetText(a.hStart, queueStartLabel(a.currentKind))
\tenable(a.hStart, ready > 0)
}''',
    "media-specific queue actions",
)
write(V420, v420)

harden = read(V420_HARDEN)
harden = replace_once(harden, 'if !a.running {\n\t\ta.runMu.Unlock()\n\t\treturn\n\t}', 'if !a.running || a.runKind != a.currentKind {\n\t\ta.runMu.Unlock()\n\t\treturn\n\t}', "pause belongs to current media")
harden = replace_once(harden, 'setText(a.hPause, "继续")', 'setText(a.hPause, queuePauseLabel(a.currentKind, true))', "image pause label")
harden = replace_once(harden, 'setText(a.hPause, "暂停")', 'setText(a.hPause, queuePauseLabel(a.currentKind, false))', "image resume label")
# Replace the second running guard, belonging to stopQueue.
old_guard = 'if !a.running {\n\t\ta.runMu.Unlock()\n\t\treturn\n\t}'
if harden.count(old_guard) != 1:
    raise RuntimeError(f"stop guard: expected one remaining match, found {harden.count(old_guard)}")
harden = harden.replace(old_guard, 'if !a.running || a.runKind != a.currentKind {\n\t\ta.runMu.Unlock()\n\t\treturn\n\t}', 1)
write(V420_HARDEN, harden)

safety = read(SAFETY)
safety = replace_regex(
    safety,
    r'func TestCompareTaskColumn\(t \*testing\.T\) \{.*?\n\}',
    '''func TestCompareTaskColumn(t *testing.T) {
\ta := &model.Task{Input: `C:\\x\\b.mp4`, InputSize: 20, OutputSize: 4, Progress: 80, Status: model.StatusDone, Width: 1920, Height: 1080, Duration: 90}
\tb := &model.Task{Input: `C:\\x\\a.mp4`, InputSize: 10, OutputSize: 8, Progress: 10, Status: model.StatusFailed, Width: 1280, Height: 720, Duration: 30}
\tif compareTaskColumn(a, b, 0) <= 0 { t.Fatal("filename sort failed") }
\tif compareTaskColumn(a, b, 2) <= 0 { t.Fatal("duration sort failed") }
\tif compareTaskColumn(a, b, 7) <= 0 { t.Fatal("input-size sort failed") }
\tif compareTaskColumn(a, b, 9) <= 0 { t.Fatal("progress sort failed") }
\tif compareTaskColumn(a, b, 10) <= 0 { t.Fatal("status rank sort failed") }
\tif taskSortLabel(8) != "输出体积" { t.Fatal("sort label mismatch") }
}''',
    "sort tests",
)
safety = replace_regex(
    safety,
    r'func TestNormalizedTaskColumnWidths\(t \*testing\.T\) \{.*?\n\}',
    '''func TestNormalizedTaskColumnWidths(t *testing.T) {
\tgot := normalizedTaskColumnWidths([]int{400, 10, 901, 160})
\twant := []int{400, 100, 76, 160, 116, 58, 90, 92, 140, 105, 124}
\tif len(got) != len(want) { t.Fatalf("column widths len=%d want=%d", len(got), len(want)) }
\tfor i := range want {
\t\tif got[i] != want[i] { t.Fatalf("column width[%d]=%d want=%d", i, got[i], want[i]) }
\t}
\tlegacy := normalizedTaskColumnWidths([]int{290, 105, 74, 120, 60, 94, 96, 140, 105, 124})
\tif len(legacy) != 11 || legacy[0] != 290 || legacy[1] != 105 || legacy[2] != 76 || legacy[3] != 74 || legacy[10] != 124 {
\t\tt.Fatalf("legacy column migration failed: %#v", legacy)
\t}
}''',
    "column width tests",
)
write(SAFETY, safety)

if CONTRACT_OLD.exists():
    CONTRACT_OLD.unlink()
contract = r'''package main

import (
    "os"
    "path/filepath"
    "strings"
    "testing"
)

func sourceFile(t *testing.T, rel string) string {
    t.Helper()
    data, err := os.ReadFile(filepath.FromSlash(rel))
    if err != nil { t.Fatal(err) }
    return string(data)
}

func TestV422DesktopSourceContracts(t *testing.T) {
    main := sourceFile(t, "main_windows.go")
    helper := sourceFile(t, "v422_windows.go")
    queue := sourceFile(t, "v420_windows.go")
    harden := sourceFile(t, "v420_harden_windows.go")
    rules := sourceFile(t, "ui_rules.go")
    if strings.Contains(main, "a.a.") { t.Fatal("invalid duplicated application receiver returned") }
    if strings.Contains(main, "hApplySelected") || strings.Contains(main, "IDC_APPLY_SELECTED") { t.Fatal("orphan bottom apply control returned") }
    if strings.Contains(main, "case NM_RCLICK:") { t.Fatal("duplicate list context-menu trigger returned") }
    for _, want := range []string{
        `const appVersion = "4.2.2"`,
        `{"分辨率", 100}, {"时长", 76}`,
        `bottomParameterWidths(a.currentKind)`,
        `drawStatusLamp(dis.HDC, rc, dot)`,
        `drawCompactResetGlyph(dis.HDC, rc, textColor)`,
        `drawContrastCenteredText(hdc, label, bar, fill, uiFontSmall)`,
        `cd.ISubItem != 8 && cd.ISubItem != 9 && cd.ISubItem != 10`,
        `taskDurationText(t)`,
        `a.refreshTotal()`,
    } {
        if !strings.Contains(main, want) { t.Fatalf("missing v4.2.2 main contract %q", want) }
    }
    if strings.Contains(main, "diameter := scaleDPI(14)") { t.Fatal("low-resolution GDI status ellipse returned") }
    for _, want := range []string{`drawCenteredText(hdc, "●"`, `withRoundedClip(hdc, fill, 1`, `func taskDurationText`, `func (a *application) v422SummarizeProgress`} {
        if !strings.Contains(helper, want) { t.Fatalf("missing helper contract %q", want) }
    }
    if !strings.Contains(queue, `enable(a.hPause, ownsRun)`) || !strings.Contains(queue, `waitingQueueLabel(runKind)`) {
        t.Fatal("bottom queue controls are not workspace-specific")
    }
    if strings.Count(harden, `a.runKind != a.currentKind`) < 2 { t.Fatal("pause/stop can still control the other media workspace") }
    if !strings.Contains(rules, `kind == model.KindImage`) || !strings.Contains(rules, `Resolution: 122`) { t.Fatal("image parameter widths are not independent") }
}
'''
write(CONTRACT_NEW, contract)

# Copy the known-good build pipeline and change only its version identity.
build = read(BUILD_OLD).replace('$version = "4.2.1"', '$version = "4.2.2"', 1)
write(BUILD_NEW, build)

work = read(WORK)
section = '''## v4.2.2｜实机 UI 小修（开发中）

本轮直接处理 v4.2.1 实机反馈：状态灯改为 DPI 感知的字体矢量圆点；图片与视频底部进度和队列按钮按当前工作区独立显示与控制；图片模式重新分配尺寸、格式、质量、大小和旋转宽度；“全部恢复默认”使用更小并带安全留白的重绘图标；压缩后条形左侧改为可辨识浅灰；视频列表新增时长列并迁移旧列宽；行内和总进度文字按蓝色填充区白字、浅色轨道黑字分区绘制。

完成标准：固定哈希、普通/竞态测试、`go vet`、Windows 双交叉构建、真实 Runtime、四套截图和原生 self-test 全部通过后，才允许进入稳定分支和轻量发布。

'''
if section.splitlines()[0] not in work:
    work = work.replace("# Mediova 工作记录\n\n", "# Mediova 工作记录\n\n" + section, 1)
write(WORK, work)

rules = read(RULES)
addition = '''
### C-11｜双工作区底部状态与列表可读性

- 视频与图片可以共用底部控件实例，但进度统计、按钮文案、启用状态和命令作用域必须以当前工作区为准；另一个媒体队列运行时，当前页不得显示或控制对方队列。
- 视频任务列表必须提供独立“时长”列；图片行显示 `—`。新增列时必须迁移旧列宽，禁止让用户已有列宽整体错位。
- 进度条文字在填充区使用白字，在未填充浅色区使用深色字；跨越边界时必须分区裁剪重绘，而不是按单一中心点猜测颜色。
- 压缩后条形的原始体积侧必须有稳定可辨识的浅灰底，结果侧按压缩效果着色。
- 状态灯和小图标必须使用 DPI 感知矢量/字体绘制或等效高分辨率资源，禁止将低分辨率位图直接拉伸。
'''
if "### C-11｜双工作区底部状态与列表可读性" not in rules:
    rules = rules.rstrip() + "\n" + addition
write(RULES, rules)

notes = '''# Mediova v4.2.2 版本说明（候选）

v4.2.2 是 v4.2.1 的 UI 与双工作区交互修补版。候选阶段不改变正式下载入口；完成 `p101-exp → p101-stable → main` 两级完整准入后，再建立正式标签和不含 FFmpeg 的轻量覆盖包。

## 本轮目标

- 顶部 FFmpeg、GPU、PotPlayer 和并发状态灯改用 DPI 感知字体矢量圆点。
- 图片与视频底部进度、按钮文案、启用状态和命令作用域按当前工作区独立。
- 图片模式加宽“尺寸”，压缩“格式 / 质量 / 大小 / 旋转”的无效占用。
- 缩小“全部恢复默认”重绘图标并增加边框安全间隙。
- 压缩后条形左侧使用可辨识浅灰底。
- 视频任务列表新增可排序“时长”列，图片显示 `—`，并兼容 v4.2.1 的 10 列宽配置。
- 行内进度和总进度采用填充区白字、未填充区深色字的分区绘制。

正式验证证据、哈希和下载地址将在发布完成后补齐。
'''
write(NOTES, notes)

# Format source before generating the authoritative hash list.
go_files = [MAIN, UI_RULES, UI_TESTS, V420, V420_HARDEN, SAFETY, CONTRACT_NEW, HELPER, HELPER_TEST]
subprocess.run(["gofmt", "-w", *[str(path) for path in go_files]], check=True)

# Refresh the existing authoritative path list and add the new v4.2.2 files.
paths: set[str] = set()
for line in read(HASHES).splitlines():
    parts = line.strip().split(maxsplit=1)
    if len(parts) == 2:
        paths.add(parts[1])
paths.discard("cmd/mediaworkbench/v421_source_contract_test.go")
paths.update({
    "build_v4.2.2.ps1",
    "cmd/mediaworkbench/v422_source_contract_test.go",
    "cmd/mediaworkbench/v422_windows.go",
    "cmd/mediaworkbench/v422_windows_test.go",
})
lines: list[str] = []
for rel in sorted(paths):
    path = CODE / rel
    if not path.is_file():
        raise RuntimeError(f"hash source path missing: {rel}")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    lines.append(f"{digest}  {rel}")
write(HASHES, "\n".join(lines) + "\n")

# Hard assertions catch accidental partial patches before any tests run.
final_main = read(MAIN)
for forbidden in ("diameter := scaleDPI(14)", "cd.ISubItem != 7", "a.taskTexts(&task)[9]", 'const appVersion = "4.2.1"'):
    if forbidden in final_main:
        raise RuntimeError(f"forbidden v4.2.1 fragment remains: {forbidden}")
if final_main.count('"时长"') < 2:
    raise RuntimeError("duration column was not fully installed")

subprocess.run(["sha256sum", "-c", "SOURCE_FILES_SHA256.txt"], cwd=CODE, check=True)
subprocess.run(["go", "test", "-count=1", "./..."], cwd=CODE, check=True)
subprocess.run(["go", "test", "-race", "-count=1", "./..."], cwd=CODE, check=True)
subprocess.run(["go", "vet", "-unsafeptr=false", "./..."], cwd=CODE, check=True)
subprocess.run(["go", "test", "-c", "./cmd/mediaworkbench", "-o", "/tmp/Mediova_v422_tests.exe"], cwd=CODE, check=True, env={**__import__('os').environ, "CGO_ENABLED": "0", "GOOS": "windows", "GOARCH": "amd64"})
subprocess.run(["go", "build", "-buildvcs=false", "-trimpath", "-ldflags=-H=windowsgui -s -w", "-o", "/tmp/Mediova_v422.exe", "./cmd/mediaworkbench"], cwd=CODE, check=True, env={**__import__('os').environ, "CGO_ENABLED": "0", "GOOS": "windows", "GOARCH": "amd64"})
print("P101 v4.2.2 source patch and portable gates passed")
