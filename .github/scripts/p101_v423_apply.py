from __future__ import annotations

import hashlib
import os
import re
import subprocess
from pathlib import Path

ROOT = Path.cwd()
PROJECT = ROOT / "projects/1-桌面软件/101-Mediova"
CODE = PROJECT / "代码"
MAIN = CODE / "cmd/mediaworkbench/main_windows.go"
CONTRACT = CODE / "cmd/mediaworkbench/v422_source_contract_test.go"
HASHES = CODE / "SOURCE_FILES_SHA256.txt"


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement, found {count}: {old[:100]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")


def replace_regex_once(path: Path, pattern: str, replacement: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{path}: regex replacement count={count}: {pattern[:100]!r}")
    path.write_text(updated, encoding="utf-8", newline="\n")


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def refresh_hashes(extra: list[str]) -> None:
    paths: set[str] = set(extra)
    for line in HASHES.read_text(encoding="utf-8").splitlines():
        parts = line.strip().split(maxsplit=1)
        if len(parts) == 2:
            paths.add(parts[1])
    rows: list[str] = []
    for rel in sorted(paths):
        path = CODE / rel
        if not path.is_file():
            raise SystemExit(f"hash source path missing: {rel}")
        rows.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {rel}")
    HASHES.write_text("\n".join(rows) + "\n", encoding="utf-8", newline="\n")


replace_once(MAIN, 'const appVersion = "4.2.2"', 'const appVersion = "4.2.3"')

compact_footer = '''\t\tmove(a.hProgress, 8, barY+76, w-16, 24)
\t\tmove(a.hStatusText, 8, barY+110, w-332, 34)
\t\tmove(a.hStart, w-324, barY+107, 116, 38)
\t\tmove(a.hPause, w-200, barY+107, 88, 38)
\t\tmove(a.hStop, w-104, barY+107, 88, 38)
'''
replace_once(MAIN, compact_footer, "")

normal_footer_and_tail = '''\t\tmove(a.hProgress, 8, barY+40, w-16, 24)
\t\tmove(a.hStatusText, 8, barY+72, w-356, 34)
\t\tmove(a.hStart, w-348, barY+69, 116, 38)
\t\tmove(a.hPause, w-224, barY+69, 88, 38)
\t\tmove(a.hStop, w-128, barY+69, 88, 38)
\t}
}
func (a *application) command(id int) {
'''
common_footer_and_tail = '''\t}

\tfooter := footerGeometryFor(w, barY, compactBottom)
\tmove(a.hProgress, footer.Progress.X, footer.Progress.Y, footer.Progress.W, footer.Progress.H)
\tmove(a.hStatusText, footer.Status.X, footer.Status.Y, footer.Status.W, footer.Status.H)
\tmove(a.hStart, footer.Start.X, footer.Start.Y, footer.Start.W, footer.Start.H)
\tmove(a.hPause, footer.Pause.X, footer.Pause.Y, footer.Pause.W, footer.Pause.H)
\tmove(a.hStop, footer.Stop.X, footer.Stop.Y, footer.Stop.W, footer.Stop.H)
}
func (a *application) command(id int) {
'''
replace_once(MAIN, normal_footer_and_tail, common_footer_and_tail)

primary_button = r'''func (a *application) drawPrimaryButton(dis *drawItemStruct) bool {
\tif dis == nil || (dis.HwndItem != a.hStart && dis.HwndItem != a.hPause && dis.HwndItem != a.hStop) {
\t\treturn false
\t}
\tpressed := dis.ItemState&ODS_SELECTED != 0
\tdisabled := dis.ItemState&ODS_DISABLED != 0
\thovered := a.hovered(dis.HwndItem)
\tbg, border := colorRef(31, 111, 213), colorRef(23, 96, 190)
\tif dis.HwndItem == a.hPause {
\t\tbg, border = colorRef(218, 143, 28), colorRef(191, 119, 18)
\t} else if dis.HwndItem == a.hStop {
\t\tbg, border = colorRef(202, 73, 67), colorRef(176, 57, 52)
\t}
\ttextColor := colorRef(255, 255, 255)
\tif hovered && !disabled {
\t\tbg = mixColor(bg, colorRef(255, 255, 255), .10)
\t\tborder = mixColor(border, colorRef(255, 255, 255), .06)
\t}
\tif pressed && !disabled {
\t\tbg = mixColor(bg, colorRef(0, 0, 0), .13)
\t\tborder = bg
\t}
\tif disabled {
\t\tbg = colorRef(235, 238, 243)
\t\tborder = colorRef(196, 203, 213)
\t\ttextColor = colorRef(126, 136, 149)
\t}
\trc := dis.RcItem
\t// Clear the complete owner-draw surface first. Without this, a disabled
\t// button can retain pixels from an earlier state and appear vertically offset.
\tfillSolid(dis.HDC, rc, colorRef(250, 251, 253))
\tinner := rect{Left: rc.Left + 1, Top: rc.Top + 1, Right: rc.Right - 1, Bottom: rc.Bottom - 1}
\tbrush, _, _ := procCreateSolidBrush.Call(bg)
\tpen, _, _ := procCreatePen.Call(PS_SOLID, 1, border)
\toldBrush, _, _ := procSelectObject.Call(dis.HDC, brush)
\toldPen, _, _ := procSelectObject.Call(dis.HDC, pen)
\tprocRoundRect.Call(dis.HDC, uintptr(inner.Left), uintptr(inner.Top), uintptr(inner.Right), uintptr(inner.Bottom), 7, 7)
\tprocSelectObject.Call(dis.HDC, oldBrush)
\tprocSelectObject.Call(dis.HDC, oldPen)
\tprocDeleteObject.Call(brush)
\tprocDeleteObject.Call(pen)

\tglyph := "\\uE768"
\tif dis.HwndItem != a.hStart {
\t\tglyph = secondaryButtonGlyph(dis.HwndItem)
\t}
\tlabel := getText(dis.HwndItem)
\tfont := uiFontBold
\tif len([]rune(label)) > 5 {
\t\tfont = uiFontSmall
\t}
\tlabelWidth := measureSingleLineWidth(dis.HDC, label, font)
\ticonWidth := int32(18)
\tgap := int32(4)
\tavailable := inner.Right - inner.Left - 12
\ttotal := iconWidth + gap + labelWidth
\tif total > available {
\t\tlabelWidth = available - iconWidth - gap
\t\tif labelWidth < 24 {
\t\t\tlabelWidth = 24
\t\t}
\t\ttotal = iconWidth + gap + labelWidth
\t}
\tleft := inner.Left + (inner.Right-inner.Left-total)/2
\ticonRC := rect{Left: left, Top: inner.Top, Right: left + iconWidth, Bottom: inner.Bottom}
\ttextRC := rect{Left: iconRC.Right + gap, Top: inner.Top, Right: iconRC.Right + gap + labelWidth, Bottom: inner.Bottom}
\tdrawCenteredText(dis.HDC, glyph, iconRC, iconFont, textColor)
\tdrawCenteredText(dis.HDC, label, textRC, font, textColor)
\treturn true
}

func (a *application) drawToolbarButton'''.replace("\\t", "\t")
replace_regex_once(
    MAIN,
    r"func \(a \*application\) drawPrimaryButton\(dis \*drawItemStruct\) bool \{.*?\n\}\n\nfunc \(a \*application\) drawToolbarButton",
    primary_button,
)

replace_once(CONTRACT, 'const appVersion = \\"4.2.2\\"', 'const appVersion = \\"4.2.3\\"')

write(
    CODE / "cmd/mediaworkbench/v423_footer.go",
    '''package main

// footerRect is expressed in unscaled logical pixels; move() applies the
// current DPI scale uniformly to every member of the footer.
type footerRect struct {
\tX int32
\tY int32
\tW int32
\tH int32
}

type footerGeometry struct {
\tProgress footerRect
\tStatus   footerRect
\tStart    footerRect
\tPause    footerRect
\tStop     footerRect
}

func footerGeometryFor(clientW, barY int32, compact bool) footerGeometry {
\tprogressY := barY + 40
\tif compact {
\t\tprogressY = barY + 76
\t}
\tconst (
\t\tmargin    int32 = 8
\t\tgap       int32 = 8
\t\tstatusGap int32 = 12
\t\tbuttonH   int32 = 36
\t\tstartW    int32 = 132
\t\tpauseW    int32 = 96
\t\tstopW     int32 = 88
\t)
\tactionY := progressY + 32
\tstopX := clientW - margin - stopW
\tpauseX := stopX - gap - pauseW
\tstartX := pauseX - gap - startW
\tstatusW := startX - statusGap - margin
\tif statusW < 120 {
\t\tstatusW = 120
\t}
\treturn footerGeometry{
\t\tProgress: footerRect{X: margin, Y: progressY, W: clientW - 2*margin, H: 24},
\t\tStatus:   footerRect{X: margin, Y: actionY, W: statusW, H: buttonH},
\t\tStart:    footerRect{X: startX, Y: actionY, W: startW, H: buttonH},
\t\tPause:    footerRect{X: pauseX, Y: actionY, W: pauseW, H: buttonH},
\t\tStop:     footerRect{X: stopX, Y: actionY, W: stopW, H: buttonH},
\t}
}

func footerRectsOverlap(a, b footerRect) bool {
\treturn a.X < b.X+b.W && a.X+a.W > b.X && a.Y < b.Y+b.H && a.Y+a.H > b.Y
}
''',
)

write(
    CODE / "cmd/mediaworkbench/v423_footer_windows.go",
    '''//go:build windows

package main

import "unsafe"

func measureSingleLineWidth(hdc uintptr, text string, font uintptr) int32 {
\tif text == "" {
\t\treturn 0
\t}
\told, _, _ := procSelectObject.Call(hdc, font)
\tif old != 0 {
\t\tdefer procSelectObject.Call(hdc, old)
\t}
\trc := rect{Right: 32767, Bottom: 128}
\tprocDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(text))), ^uintptr(0), uintptr(unsafe.Pointer(&rc)), DT_LEFT|DT_SINGLELINE|DT_CALCRECT)
\twidth := rc.Right - rc.Left
\tif width < 0 {
\t\treturn 0
\t}
\treturn width
}
''',
)

write(
    CODE / "cmd/mediaworkbench/v423_footer_test.go",
    '''package main

import "testing"

func TestFooterGeometryKeepsActionButtonsAligned(t *testing.T) {
\tcases := []struct {
\t\tname    string
\t\twidth   int32
\t\tbarY    int32
\t\tcompact bool
\t}{
\t\t{"1120x720", 1120, 556, true},
\t\t{"1280x720", 1280, 556, true},
\t\t{"1450x820", 1450, 701, false},
\t\t{"1650x930", 1650, 811, false},
\t}
\tfor _, tc := range cases {
\t\tt.Run(tc.name, func(t *testing.T) {
\t\t\tg := footerGeometryFor(tc.width, tc.barY, tc.compact)
\t\t\tbuttons := []footerRect{g.Start, g.Pause, g.Stop}
\t\t\tfor i, button := range buttons {
\t\t\t\tif button.Y != g.Start.Y || button.H != g.Start.H {
\t\t\t\t\tt.Fatalf("button %d is not on shared baseline: %+v start=%+v", i, button, g.Start)
\t\t\t\t}
\t\t\t\tif footerRectsOverlap(g.Progress, button) || footerRectsOverlap(g.Status, button) {
\t\t\t\t\tt.Fatalf("button %d overlaps footer content: %+v", i, button)
\t\t\t\t}
\t\t\t}
\t\t\tif g.Pause.X-(g.Start.X+g.Start.W) != 8 || g.Stop.X-(g.Pause.X+g.Pause.W) != 8 {
\t\t\t\tt.Fatalf("button gaps changed: start=%+v pause=%+v stop=%+v", g.Start, g.Pause, g.Stop)
\t\t\t}
\t\t\tif g.Stop.X+g.Stop.W != tc.width-8 {
\t\t\t\tt.Fatalf("button group is not right aligned: %+v width=%d", g.Stop, tc.width)
\t\t\t}
\t\t\tif g.Progress.Y+g.Progress.H+8 != g.Start.Y {
\t\t\t\tt.Fatalf("progress/action gap changed: progress=%+v start=%+v", g.Progress, g.Start)
\t\t\t}
\t\t})
\t}
}
''',
)

write(
    PROJECT / "Mediova_v4.2.3_版本说明.md",
    '''# Mediova v4.2.3 版本说明（候选）

v4.2.3 专门修复视频与图片模式右下角“开始 / 暂停 / 停止”按钮错乱，不扩张新的产品功能。

## 修复内容

- 底部进度条、状态文字和三个操作按钮统一由同一个 footer 几何模型布局。
- 三个按钮始终同高、同基线、固定间距并整体右对齐。
- 视频与图片复用相同几何规则，只保留各自“转换 / 压缩”文案与队列作用域。
- 所有 footer 间距均使用逻辑像素并由 `move()` 统一执行 DPI 缩放。
- 主按钮自绘前完整清除画布，避免禁用态残留像素造成外框上下错位。
- 图标与文字作为整体居中；长状态文案自动使用较小字体，不改变外框尺寸。

## 验证目标

- 1120×720、1280×720、1450×820、1650×930；
- 紧凑与宽屏 footer；
- 视频、图片、空闲、运行、暂停与禁用状态；
- 固定哈希、普通测试、全量竞态、`go vet`、Windows 测试二进制与 GUI EXE 交叉构建；
- 稳定和正式阶段真实 Windows Runtime、截图与原生 self-test。

v4.2.3 通过后继续推进 v4.3.0，不单独停止开发。
''',
)

replace_once(
    PROJECT / "工作记录.md",
    "用户在真实桌面中确认 v4.2.2 整体明显改善，但视频和图片模式的右下角“开始 / 暂停 / 停止”按钮排布仍存在错乱：按钮组没有稳定共享同一基线，按钮高度、顶部留白、右侧停靠和进度条间距在部分窗口尺寸下不一致。该问题已登记为 v4.2.3 第一优先级修复，不通过单个截图尺寸的坐标微调解决。",
    "用户在真实桌面中确认 v4.2.2 整体明显改善，但视频和图片模式的右下角“开始 / 暂停 / 停止”按钮排布仍存在错乱。v4.2.3 已完成候选实现：按钮组、状态文字和进度条改由统一 footer 几何模型管理，主按钮自绘也先清除完整画布；待稳定与正式 Windows 截图复核。",
)

subprocess.run(["gofmt", "-w", str(CODE / "cmd/mediaworkbench/v423_footer.go"), str(CODE / "cmd/mediaworkbench/v423_footer_windows.go"), str(CODE / "cmd/mediaworkbench/v423_footer_test.go"), str(MAIN), str(CONTRACT)], check=True)
refresh_hashes([
    "cmd/mediaworkbench/v423_footer.go",
    "cmd/mediaworkbench/v423_footer_windows.go",
    "cmd/mediaworkbench/v423_footer_test.go",
])

subprocess.run(["sha256sum", "-c", "SOURCE_FILES_SHA256.txt"], cwd=CODE, check=True)
subprocess.run(["go", "test", "-count=1", "./..."], cwd=CODE, check=True)
subprocess.run(["go", "test", "-race", "-count=1", "./..."], cwd=CODE, check=True)
subprocess.run(["go", "vet", "-unsafeptr=false", "./..."], cwd=CODE, check=True)
env = {**os.environ, "CGO_ENABLED": "0", "GOOS": "windows", "GOARCH": "amd64"}
subprocess.run(["go", "test", "-c", "./cmd/mediaworkbench", "-o", "/tmp/Mediova_v423_tests.exe"], cwd=CODE, env=env, check=True)
subprocess.run(["go", "build", "-buildvcs=false", "-trimpath", "-ldflags=-H=windowsgui -s -w", "-o", "/tmp/Mediova_v423.exe", "./cmd/mediaworkbench"], cwd=CODE, env=env, check=True)
print("P101 Mediova v4.2.3 passed portable gates")
