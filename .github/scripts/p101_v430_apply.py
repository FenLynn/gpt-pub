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
TRIM = CODE / "cmd/mediaworkbench/trim_dialog_windows.go"
CONTRACT = CODE / "cmd/mediaworkbench/v422_source_contract_test.go"
HASHES = CODE / "SOURCE_FILES_SHA256.txt"


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement, found {count}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")


def replace_regex_once(path: Path, pattern: str, replacement: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{path}: regex replacement count={count}: {pattern[:120]!r}")
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


replace_once(MAIN, 'const appVersion = "4.2.3"', 'const appVersion = "4.3.0"')
replace_once(CONTRACT, 'const appVersion = "4.2.3"', 'const appVersion = "4.3.0"')

replace_once(
    TRIM,
    '''\tIDC_SEEK_PLUS_SEC    = 4020
)''',
    '''\tIDC_SEEK_PLUS_SEC       = 4020
\tIDC_CROP_ASPECT         = 4021
\tIDC_CROP_CENTER         = 4022
\tIDC_CROP_APPLY_SELECTED = 4023
)''',
)

replace_once(
    TRIM,
    '''\thTrack   uintptr
\thNow     uintptr

\tframeW, frameH int''',
    '''\thTrack   uintptr
\thNow     uintptr
\thAspect  uintptr

\tframeW, frameH int''',
)
replace_once(
    TRIM,
    '''\tdragging       bool
\tdragStart      point
}''',
    '''\tdragging       bool
\tdragStart      point
\tapplySelected  bool
}''',
)

replace_once(
    TRIM,
    'func showTrimCropDialog(owner *application, task *model.Task, opts model.TaskOptions) (model.TaskOptions, bool) {',
    'func showTrimCropDialog(owner *application, task *model.Task, opts model.TaskOptions) (model.TaskOptions, bool, bool) {',
)
replace_once(TRIM, 'return opts, false\n\t}', 'return opts, false, false\n\t}',)
# The window-creation failure is the second two-value return.
replace_once(TRIM, 'return opts, false\n\t}\n\td.hwnd = h', 'return opts, false, false\n\t}\n\td.hwnd = h')
replace_once(TRIM, 'return d.opts, d.accepted\n}', 'return d.opts, d.accepted, d.applySelected\n}')

replace_once(
    TRIM,
    '''\tcase WM_HSCROLL:
\t\tif d != nil && lParam == d.hTrack {
\t\t\td.timelineChanged(int(loWord(wParam)))
\t\t}
\t\treturn 0
\tcase WM_CLOSE:''',
    '''\tcase WM_HSCROLL:
\t\tif d != nil && lParam == d.hTrack {
\t\t\td.timelineChanged(int(loWord(wParam)))
\t\t}
\t\treturn 0
\tcase WM_KEYDOWN:
\t\tif d != nil && d.keyDown(int(wParam)) {
\t\t\treturn 0
\t\t}
\tcase WM_CLOSE:''',
)

replace_once(
    TRIM,
    '''\tcreateControl("STATIC", fmt.Sprintf("转正后画面：%d×%d", d.frameW, d.frameH), WS_CHILD|WS_VISIBLE, x+200, 188, 132, 52, d.hwnd, 0)
\tcreateControl("BUTTON", "恢复全画面", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x+200, 260, 132, 32, d.hwnd, IDC_FULL_FRAME)
\td.hInfo = createControlEx(WS_EX_CLIENTEDGE, "EDIT", "", WS_CHILD|WS_VISIBLE|ES_MULTILINE|ES_READONLY|WS_VSCROLL, x, 350, 332, 138, d.hwnd, 0)
\tcreateControl("BUTTON", "生成高清预览", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x, 500, 332, 36, d.hwnd, IDC_FRAME_PREVIEW)
\tcreateControl("BUTTON", "应用到任务", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_DEFPUSHBUTTON, x, 660, 200, 40, d.hwnd, IDC_TRIM_OK)
\tcreateControl("BUTTON", "取消", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x+208, 660, 124, 40, d.hwnd, IDC_TRIM_CANCEL)''',
    '''\tcreateControl("STATIC", fmt.Sprintf("转正后画面：%d×%d", d.frameW, d.frameH), WS_CHILD|WS_VISIBLE, x+200, 188, 132, 52, d.hwnd, 0)
\tcreateControl("BUTTON", "恢复全画面", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x+200, 260, 132, 32, d.hwnd, IDC_FULL_FRAME)
\tcreateControl("STATIC", "裁剪比例", WS_CHILD|WS_VISIBLE, x, 312, 70, 26, d.hwnd, 0)
\td.hAspect = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, x+72, 306, 120, 200, d.hwnd, IDC_CROP_ASPECT)
\tfor _, label := range []string{"自由", "16:9", "9:16", "1:1", "4:3"} {
\t\tsend(d.hAspect, CB_ADDSTRING, 0, uintptr(unsafe.Pointer(p(label))))
\t}
\tsend(d.hAspect, CB_SETCURSEL, 0, 0)
\tcreateControl("BUTTON", "居中适配", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x+200, 306, 132, 32, d.hwnd, IDC_CROP_CENTER)
\td.hInfo = createControlEx(WS_EX_CLIENTEDGE, "EDIT", "", WS_CHILD|WS_VISIBLE|ES_MULTILINE|ES_READONLY|WS_VSCROLL, x, 350, 332, 138, d.hwnd, 0)
\tcreateControl("BUTTON", "生成高清预览", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x, 500, 332, 36, d.hwnd, IDC_FRAME_PREVIEW)
\tcreateControl("BUTTON", "应用到已选任务", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x, 614, 332, 36, d.hwnd, IDC_CROP_APPLY_SELECTED)
\tcreateControl("BUTTON", "应用到当前任务", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_DEFPUSHBUTTON, x, 660, 200, 40, d.hwnd, IDC_TRIM_OK)
\tcreateControl("BUTTON", "取消", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x+208, 660, 124, 40, d.hwnd, IDC_TRIM_CANCEL)''',
)

replace_once(
    TRIM,
    '''\tcase IDC_FULL_FRAME:
\t\td.opts.Crop = model.Crop{Enabled: false, X: 0, Y: 0, Width: evenSize(d.frameW), Height: evenSize(d.frameH)}
\t\tsend(d.hCrop, BM_SETCHECK, 0, 0)
\t\td.cropToControls()
\tcase IDC_FRAME_PREVIEW:''',
    '''\tcase IDC_FULL_FRAME:
\t\td.opts.Crop = model.Crop{Enabled: false, X: 0, Y: 0, Width: evenSize(d.frameW), Height: evenSize(d.frameH)}
\t\tsend(d.hCrop, BM_SETCHECK, 0, 0)
\t\td.cropToControls()
\tcase IDC_CROP_ASPECT:
\t\td.updateInfo()
\tcase IDC_CROP_CENTER:
\t\td.fitSelectedAspect()
\tcase IDC_FRAME_PREVIEW:''',
)
replace_once(
    TRIM,
    '''\tcase IDC_TRIM_OK:
\t\tif d.read() {
\t\t\td.accepted = true
\t\t\td.done = true
\t\t\td.closed.Store(true)
\t\t\tprocDestroyWindow.Call(d.hwnd)
\t\t}
\tcase IDC_TRIM_CANCEL:''',
    '''\tcase IDC_CROP_APPLY_SELECTED:
\t\tif d.read() {
\t\t\td.applySelected = true
\t\t\td.accepted = true
\t\t\td.done = true
\t\t\td.closed.Store(true)
\t\t\tprocDestroyWindow.Call(d.hwnd)
\t\t}
\tcase IDC_TRIM_OK:
\t\tif d.read() {
\t\t\td.applySelected = false
\t\t\td.accepted = true
\t\t\td.done = true
\t\t\td.closed.Store(true)
\t\t\tprocDestroyWindow.Call(d.hwnd)
\t\t}
\tcase IDC_TRIM_CANCEL:''',
)

insert_before_timeline = '''func (d *trimDialog) selectedAspect() (int, int, bool) {
\tif d.hAspect == 0 {
\t\treturn 0, 0, false
\t}
\treturn media.CropAspect(comboText(d.hAspect))
}

func (d *trimDialog) fitSelectedAspect() {
\tratioW, ratioH, ok := d.selectedAspect()
\tif !ok {
\t\treturn
\t}
\td.opts.Crop = media.FitAspectCrop(d.frameW, d.frameH, ratioW, ratioH)
\tsend(d.hCrop, BM_SETCHECK, BST_CHECKED, 0)
\td.cropToControls()
}

func (d *trimDialog) keyDown(key int) bool {
\tshiftState, _, _ := procGetKeyState.Call(0x10)
\tshifted := int16(shiftState&0xffff) < 0
\tswitch key {
\tcase 0x25: // Left
\t\tif shifted {
\t\t\td.seek(-1)
\t\t} else {
\t\t\td.seek(-1 / d.safeFPS())
\t\t}
\t\treturn true
\tcase 0x27: // Right
\t\tif shifted {
\t\t\td.seek(1)
\t\t} else {
\t\t\td.seek(1 / d.safeFPS())
\t\t}
\t\treturn true
\tcase 'I':
\t\tsetText(d.hStart, formatSecondsClock(d.currentAt))
\t\td.updateInfo()
\t\treturn true
\tcase 'O':
\t\tsetText(d.hEnd, formatSecondsClock(d.currentAt))
\t\td.updateInfo()
\t\treturn true
\tcase 'R':
\t\td.opts.Crop = model.Crop{Enabled: false, X: 0, Y: 0, Width: evenSize(d.frameW), Height: evenSize(d.frameH)}
\t\td.cropToControls()
\t\treturn true
\t}
\treturn false
}

'''
replace_once(TRIM, 'func (d *trimDialog) timelineChanged(code int) {', insert_before_timeline + 'func (d *trimDialog) timelineChanged(code int) {')

replace_regex_once(
    TRIM,
    r"func \(d \*trimDialog\) setDragCrop\(a, b point\) \{.*?\n\}\n\nfunc \(d \*trimDialog\) cleanup",
    '''func (d *trimDialog) setDragCrop(a, b point) {
\tratioW, ratioH, locked := d.selectedAspect()
\td.opts.Crop = media.DragCropWithAspect(d.frameW, d.frameH, int(a.X), int(a.Y), int(b.X), int(b.Y), ratioW, ratioH, locked)
\td.cropToControls()
}

func (d *trimDialog) cleanup''',
)

new_edit = '''func (a *application) editTrimCrop() {
\tidxs := a.selectedTaskIndices()
\tif len(idxs) == 0 {
\t\tmessageBox(a.hwnd, "时长与画面", "请先选择一个任务。", MB_OK|MB_ICONINFORMATION)
\t\treturn
\t}
\tidx := idxs[0]
\ta.mu.Lock()
\tif idx < 0 || idx >= len(a.tasks) || a.tasks[idx] == nil {
\t\ta.mu.Unlock()
\t\treturn
\t}
\tselected := a.tasks[idx]
\tif selected.IsLocked() {
\t\ta.mu.Unlock()
\t\tmessageBox(a.hwnd, "任务已锁定", "队列中、转换中或暂停任务需要先通过右键进入搁置编辑。", MB_OK|MB_ICONINFORMATION)
\t\treturn
\t}
\ttaskCopy := *selected
\topts := a.settings.EffectiveOptions(selected)
\ta.mu.Unlock()

\tupdated, ok, applySelected := showTrimCropDialog(a, &taskCopy, opts)
\tif !ok {
\t\treturn
\t}
\tcopied := 0
\ta.mu.Lock()
\tif idx >= 0 && idx < len(a.tasks) && a.tasks[idx] != nil && a.tasks[idx].ID == taskCopy.ID {
\t\ta.tasks[idx].Options = updated
\t\tresetTaskAfterOptionChange(a.tasks[idx])
\t\tif applySelected {
\t\t\tordered := []int{idx}
\t\t\tfor _, candidate := range idxs {
\t\t\t\tif candidate != idx {
\t\t\t\t\tordered = append(ordered, candidate)
\t\t\t\t}
\t\t\t}
\t\t\tcopied = copyTrimCropToTargets(a.settings, a.tasks, ordered)
\t\t}
\t}
\ta.mu.Unlock()
\ta.saveSession()
\ta.refreshAll()
\tif applySelected {
\t\tsetText(a.hStatusText, fmt.Sprintf("裁剪设置已应用到当前任务，并同步到 %d 个可编辑的已选任务。", copied))
\t} else {
\t\tsetText(a.hStatusText, "裁剪设置已应用到当前任务。")
\t}
}

func (a *application) copyTrimCropOptions'''
replace_regex_once(
    MAIN,
    r"func \(a \*application\) editTrimCrop\(\) \{.*?\n\}\n\nfunc \(a \*application\) copyTrimCropOptions",
    new_edit,
)

write(
    CODE / "internal/media/crop.go",
    '''package media

import (
\t"math"
\t"strings"

\t"mediaworkbench/internal/model"
)

func CropAspect(name string) (int, int, bool) {
\tswitch strings.TrimSpace(name) {
\tcase "16:9":
\t\treturn 16, 9, true
\tcase "9:16":
\t\treturn 9, 16, true
\tcase "1:1":
\t\treturn 1, 1, true
\tcase "4:3":
\t\treturn 4, 3, true
\tdefault:
\t\treturn 0, 0, false
\t}
}

func evenCropValue(v int) int {
\tif v < 0 {
\t\treturn 0
\t}
\treturn v &^ 1
}

func evenCropSize(v int) int {
\tif v < 2 {
\t\treturn 2
\t}
\treturn v &^ 1
}

func ClampCrop(frameW, frameH int, crop model.Crop) model.Crop {
\tif frameW < 2 || frameH < 2 {
\t\treturn model.Crop{}
\t}
\tcrop.X = evenCropValue(crop.X)
\tcrop.Y = evenCropValue(crop.Y)
\tif crop.X > frameW-2 {
\t\tcrop.X = evenCropValue(frameW - 2)
\t}
\tif crop.Y > frameH-2 {
\t\tcrop.Y = evenCropValue(frameH - 2)
\t}
\tcrop.Width = evenCropSize(crop.Width)
\tcrop.Height = evenCropSize(crop.Height)
\tif crop.X+crop.Width > frameW {
\t\tcrop.Width = evenCropSize(frameW - crop.X)
\t}
\tif crop.Y+crop.Height > frameH {
\t\tcrop.Height = evenCropSize(frameH - crop.Y)
\t}
\tcrop.Enabled = true
\treturn crop
}

func FitAspectCrop(frameW, frameH, ratioW, ratioH int) model.Crop {
\tif frameW < 2 || frameH < 2 || ratioW <= 0 || ratioH <= 0 {
\t\treturn model.Crop{Enabled: false, Width: evenCropSize(frameW), Height: evenCropSize(frameH)}
\t}
\tw := frameW
\th := int(math.Round(float64(w) * float64(ratioH) / float64(ratioW)))
\tif h > frameH {
\t\th = frameH
\t\tw = int(math.Round(float64(h) * float64(ratioW) / float64(ratioH)))
\t}
\tw, h = evenCropSize(w), evenCropSize(h)
\tx := evenCropValue((frameW - w) / 2)
\ty := evenCropValue((frameH - h) / 2)
\treturn ClampCrop(frameW, frameH, model.Crop{Enabled: true, X: x, Y: y, Width: w, Height: h})
}

func DragCropWithAspect(frameW, frameH, ax, ay, bx, by, ratioW, ratioH int, locked bool) model.Crop {
\tdx, dy := bx-ax, by-ay
\tsignX, signY := 1, 1
\tif dx < 0 {
\t\tsignX, dx = -1, -dx
\t}
\tif dy < 0 {
\t\tsignY, dy = -1, -dy
\t}
\tif dx < 2 {
\t\tdx = 2
\t}
\tif dy < 2 {
\t\tdy = 2
\t}
\tif locked && ratioW > 0 && ratioH > 0 {
\t\tfitH := int(math.Round(float64(dx) * float64(ratioH) / float64(ratioW)))
\t\tif fitH <= dy {
\t\t\tdy = fitH
\t\t} else {
\t\t\tdx = int(math.Round(float64(dy) * float64(ratioW) / float64(ratioH)))
\t\t}
\t}
\tx, y := ax, ay
\tif signX < 0 {
\t\tx = ax - dx
\t}
\tif signY < 0 {
\t\ty = ay - dy
\t}
\treturn ClampCrop(frameW, frameH, model.Crop{Enabled: true, X: x, Y: y, Width: dx, Height: dy})
}
''',
)

write(
    CODE / "internal/media/crop_test.go",
    '''package media

import "testing"

func TestFitAspectCrop(t *testing.T) {
\tcases := []struct {
\t\tw, h, rw, rh int
\t}{
\t\t{1920, 1080, 1, 1},
\t\t{1080, 1920, 16, 9},
\t\t{4000, 3000, 9, 16},
\t\t{1920, 1080, 4, 3},
\t}
\tfor _, tc := range cases {
\t\tcrop := FitAspectCrop(tc.w, tc.h, tc.rw, tc.rh)
\t\tif !crop.Enabled || crop.X < 0 || crop.Y < 0 || crop.X+crop.Width > tc.w || crop.Y+crop.Height > tc.h {
\t\t\tt.Fatalf("invalid fitted crop: %+v frame=%dx%d", crop, tc.w, tc.h)
\t\t}
\t\tgot := float64(crop.Width) / float64(crop.Height)
\t\twant := float64(tc.rw) / float64(tc.rh)
\t\tif got < want-.01 || got > want+.01 {
\t\t\tt.Fatalf("aspect mismatch got=%.4f want=%.4f crop=%+v", got, want, crop)
\t\t}
\t}
}

func TestDragCropWithAspectClampsAndLocks(t *testing.T) {
\tcrop := DragCropWithAspect(1920, 1080, 1700, 900, 400, 200, 16, 9, true)
\tif crop.X < 0 || crop.Y < 0 || crop.X+crop.Width > 1920 || crop.Y+crop.Height > 1080 {
\t\tt.Fatalf("crop escaped frame: %+v", crop)
\t}
\tratio := float64(crop.Width) / float64(crop.Height)
\tif ratio < 16.0/9-.02 || ratio > 16.0/9+.02 {
\t\tt.Fatalf("ratio not locked: %.4f %+v", ratio, crop)
\t}
}

func TestCropAspectNames(t *testing.T) {
\tif w, h, ok := CropAspect("9:16"); !ok || w != 9 || h != 16 {
\t\tt.Fatalf("unexpected aspect: %d:%d ok=%v", w, h, ok)
\t}
\tif _, _, ok := CropAspect("自由"); ok {
\t\tt.Fatal("free aspect must not lock")
\t}
}
''',
)

write(
    CODE / "cmd/mediaworkbench/v430_source_contract_test.go",
    '''package main

import (
\t"os"
\t"strings"
\t"testing"
)

func TestV430PreviewCropSourceContracts(t *testing.T) {
\ttrim, err := os.ReadFile("trim_dialog_windows.go")
\tif err != nil {
\t\tt.Fatal(err)
\t}
\tmain, err := os.ReadFile("main_windows.go")
\tif err != nil {
\t\tt.Fatal(err)
\t}
\tfor _, want := range []string{"IDC_CROP_ASPECT", "应用到已选任务", "func (d *trimDialog) keyDown", "media.DragCropWithAspect", "media.FitAspectCrop"} {
\t\tif !strings.Contains(string(trim), want) {
\t\t\tt.Fatalf("missing v4.3.0 trim contract %q", want)
\t\t}
\t}
\tif !strings.Contains(string(main), "applySelected := showTrimCropDialog") || !strings.Contains(string(main), "copyTrimCropToTargets") {
\t\tt.Fatal("batch trim/crop apply path missing")
\t}
}
''',
)

write(
    PROJECT / "Mediova_v4.3.0_版本说明.md",
    '''# Mediova v4.3.0 版本说明（候选）

v4.3.0 在现有时长与画面裁剪对话框上完成可操作性升级，不建立第二套预览系统。

## 新增能力

- 裁剪比例：自由、16:9、9:16、1:1、4:3。
- 居中适配：按所选比例在转正后的画面内生成最大居中区域。
- 拖框比例锁定：选择固定比例后，鼠标拖动始终保持该比例并自动限制在画面内。
- 键盘微调：左右方向键逐帧移动，Shift+左右逐秒移动，I/O 设置开始/结束，R 恢复全画面。
- “应用到已选任务”：当前任务保存后，将时长与裁剪按目标分辨率安全缩放到其他可编辑任务。
- 纯裁剪函数和边界测试，保证偶数坐标、最小尺寸、比例和画面边界。

v4.3.0 通过后继续推进 v4.4.0 图片处理扩展。
''',
)

subprocess.run(["gofmt", "-w", str(MAIN), str(TRIM), str(CONTRACT), str(CODE / "internal/media/crop.go"), str(CODE / "internal/media/crop_test.go"), str(CODE / "cmd/mediaworkbench/v430_source_contract_test.go")], check=True)
refresh_hashes([
    "internal/media/crop.go",
    "internal/media/crop_test.go",
    "cmd/mediaworkbench/v430_source_contract_test.go",
])
subprocess.run(["sha256sum", "-c", "SOURCE_FILES_SHA256.txt"], cwd=CODE, check=True)
subprocess.run(["go", "test", "-count=1", "./..."], cwd=CODE, check=True)
subprocess.run(["go", "test", "-race", "-count=1", "./..."], cwd=CODE, check=True)
subprocess.run(["go", "vet", "-unsafeptr=false", "./..."], cwd=CODE, check=True)
env = {**os.environ, "CGO_ENABLED": "0", "GOOS": "windows", "GOARCH": "amd64"}
subprocess.run(["go", "test", "-c", "./cmd/mediaworkbench", "-o", "/tmp/Mediova_v430_tests.exe"], cwd=CODE, env=env, check=True)
subprocess.run(["go", "build", "-buildvcs=false", "-trimpath", "-ldflags=-H=windowsgui -s -w", "-o", "/tmp/Mediova_v430.exe", "./cmd/mediaworkbench"], cwd=CODE, env=env, check=True)
print("P101 Mediova v4.3.0 passed portable gates")
