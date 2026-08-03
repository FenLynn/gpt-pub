from __future__ import annotations

import hashlib
import os
import subprocess
from pathlib import Path

ROOT = Path.cwd()
PROJECT = ROOT / "projects/1-桌面软件/101-Mediova"
CODE = PROJECT / "代码"
MAIN = CODE / "cmd/mediaworkbench/main_windows.go"
TRIM = CODE / "cmd/mediaworkbench/trim_dialog_windows.go"
FFMPEG = CODE / "internal/media/ffmpeg.go"
CONTRACT = CODE / "cmd/mediaworkbench/v422_source_contract_test.go"
HASHES = CODE / "SOURCE_FILES_SHA256.txt"


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement, found {count}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")


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


replace_once(MAIN, 'const appVersion = "4.3.0"', 'const appVersion = "4.4.0"')
replace_once(CONTRACT, 'const appVersion = "4.3.0"', 'const appVersion = "4.4.0"')

replace_once(
    TRIM,
    '''\tif opts.TrimEnd <= 0 || opts.TrimEnd > task.Duration {
\t\topts.TrimEnd = task.Duration
\t}''',
    '''\tif task.Kind == model.KindImage {
\t\topts.TrimStart = 0
\t\topts.TrimEnd = 0
\t} else if opts.TrimEnd <= 0 || opts.TrimEnd > task.Duration {
\t\topts.TrimEnd = task.Duration
\t}''',
)
replace_once(
    TRIM,
    '''\ttitle := "时长与画面裁剪 · " + filepath.Base(task.Input)''',
    '''\ttitle := "时长与画面裁剪 · " + filepath.Base(task.Input)
\tif task.Kind == model.KindImage {
\t\ttitle = "图片画面裁剪 · " + filepath.Base(task.Input)
\t}''',
)
replace_once(
    TRIM,
    '''\td.hTrack = createControl("msctls_trackbar32", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP, 15, 615, 700, 38, d.hwnd, IDC_TIMELINE)
\tsend(d.hTrack, TBM_SETRANGE, 1, uintptr(uint32(10000)<<16))
\tsend(d.hTrack, TBM_SETTICFREQ, 1000, 0)
\td.setTimelineFromTime()''',
    '''\td.hTrack = createControl("msctls_trackbar32", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP, 15, 615, 700, 38, d.hwnd, IDC_TIMELINE)
\tsend(d.hTrack, TBM_SETRANGE, 1, uintptr(uint32(10000)<<16))
\tsend(d.hTrack, TBM_SETTICFREQ, 1000, 0)
\td.setTimelineFromTime()
\tif d.task.Kind == model.KindImage {
\t\tfor _, h := range []uintptr{d.hNow, d.hTrack} {
\t\t\tenable(h, false)
\t\t}
\t}''',
)
replace_once(
    TRIM,
    '''\tcreateControl("BUTTON", "恢复完整时长", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x, 98, 332, 32, d.hwnd, IDC_FULL_TIME)

\td.hCrop = createControl''',
    '''\tcreateControl("BUTTON", "恢复完整时长", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x, 98, 332, 32, d.hwnd, IDC_FULL_TIME)
\tif d.task.Kind == model.KindImage {
\t\tenable(d.hStart, false)
\t\tenable(d.hEnd, false)
\t\tsetText(d.hStart, "图片")
\t\tsetText(d.hEnd, "无时间轴")
\t}

\td.hCrop = createControl''',
)
replace_once(
    TRIM,
    '''func (d *trimDialog) read() bool {
\tstart, err := parseTimeValue(getText(d.hStart))''',
    '''func (d *trimDialog) read() bool {
\tstart, end := 0.0, 0.0
\tif d.task.Kind == model.KindImage {
\t\td.cropFromControls(true)
\t\tif d.opts.Crop.Enabled {
\t\t\tc := d.opts.Crop
\t\t\tif c.Width < 2 || c.Height < 2 || c.X < 0 || c.Y < 0 || c.X+c.Width > d.frameW || c.Y+c.Height > d.frameH {
\t\t\t\tmessageBox(d.hwnd, "裁剪区域", "裁剪区域必须位于图片范围内，且宽高至少为 2 像素。", MB_OK|MB_ICONERROR)
\t\t\t\treturn false
\t\t\t}
\t\t}
\t\td.opts.TrimStart = 0
\t\td.opts.TrimEnd = 0
\t\treturn true
\t}
\tstart, err := parseTimeValue(getText(d.hStart))''',
)
replace_once(
    TRIM,
    '''func (d *trimDialog) updateInfo() {
\tstart, _ := parseTimeValue(getText(d.hStart))
\tend, _ := parseTimeValue(getText(d.hEnd))''',
    '''func (d *trimDialog) updateInfo() {
\tstart, end := 0.0, 0.0
\tif d.task.Kind != model.KindImage {
\t\tstart, _ = parseTimeValue(getText(d.hStart))
\t\tend, _ = parseTimeValue(getText(d.hEnd))
\t}''',
)
replace_once(
    TRIM,
    '''\tsetText(d.hInfo, fmt.Sprintf("保留片段：%s → %s\\r\\n输出时长：%s\\r\\n\\r\\n保留区域：%s\\r\\n编码顺序：转正 → 裁剪 → 缩放", formatSecondsClock(start), formatSecondsClock(end), formatSecondsClock(end-start), crop))''',
    '''\tif d.task.Kind == model.KindImage {
\t\tsetText(d.hInfo, fmt.Sprintf("图片输入：%s\\r\\n保留区域：%s\\r\\n处理顺序：转正 → 裁剪 → 缩放 → 编码\\r\\n拍摄时间与文件时间按全局设置保留。", filepath.Ext(d.task.Input), crop))
\t\treturn
\t}
\tsetText(d.hInfo, fmt.Sprintf("保留片段：%s → %s\\r\\n输出时长：%s\\r\\n\\r\\n保留区域：%s\\r\\n编码顺序：转正 → 裁剪 → 缩放", formatSecondsClock(start), formatSecondsClock(end), formatSecondsClock(end-start), crop))''',
)
replace_once(
    TRIM,
    '''\treq := media.ConvertRequest{Input: d.task.Input, Output: out, Kind: model.KindVideo,''',
    '''\treq := media.ConvertRequest{Input: d.task.Input, Output: out, Kind: d.task.Kind,''',
)
replace_once(
    FFMPEG,
    '''func Convert(ctx context.Context, ffmpeg string, req ConvertRequest, progress ProgressFunc) (engine string, err error) {
\tif req.Kind == model.KindImage {
\t\treturn convertImage(ctx, ffmpeg, req, progress)
\t}''',
    '''func Convert(ctx context.Context, ffmpeg string, req ConvertRequest, progress ProgressFunc) (engine string, err error) {
\tif req.Kind == model.KindImage {
\t\tif err := PreflightModernImage(ctx, ffmpeg, req.Input); err != nil {
\t\t\treturn "FFmpeg图片解码预检", err
\t\t}
\t\tengine, err := convertImage(ctx, ffmpeg, req, progress)
\t\tif err != nil {
\t\t\terr = ExplainModernImageFailure(req.Input, err)
\t\t}
\t\treturn engine, err
\t}''',
)

write(
    CODE / "internal/media/image_input.go",
    '''package media

import (
\t"context"
\t"fmt"
\t"os/exec"
\t"path/filepath"
\t"strings"
\t"time"
)

func IsModernImageInput(path string) bool {
\tswitch strings.ToLower(filepath.Ext(path)) {
\tcase ".heic", ".heif", ".avif":
\t\treturn true
\tdefault:
\t\treturn false
\t}
}

func ExplainModernImageFailure(path string, err error) error {
\tif err == nil || !IsModernImageInput(path) {
\t\treturn err
\t}
\treturn fmt.Errorf("当前 FFmpeg 无法解码 %s。请更换支持 HEIC/HEIF/AVIF 的完整 FFmpeg 构建；源文件未被修改：%w", strings.ToUpper(strings.TrimPrefix(filepath.Ext(path), ".")), err)
}

func PreflightModernImage(parent context.Context, ffmpeg, input string) error {
\tif !IsModernImageInput(input) {
\t\treturn nil
\t}
\tctx, cancel := context.WithTimeout(parent, 15*time.Second)
\tdefer cancel()
\tcmd := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-v", "error", "-i", input, "-frames:v", "1", "-f", "null", nullDevice())
\tconfigureCommand(cmd)
\toutput, err := cmd.CombinedOutput()
\tif err == nil {
\t\treturn nil
\t}
\tdetail := strings.TrimSpace(string(output))
\tif len(detail) > 500 {
\t\tdetail = detail[len(detail)-500:]
\t}
\tif detail == "" {
\t\tdetail = err.Error()
\t}
\treturn ExplainModernImageFailure(input, fmt.Errorf("解码预检失败：%s", detail))
}
''',
)
write(
    CODE / "internal/media/image_input_test.go",
    '''package media

import (
\t"errors"
\t"strings"
\t"testing"
)

func TestModernImageExtensions(t *testing.T) {
\tfor _, name := range []string{"a.HEIC", "b.heif", "c.AvIf"} {
\t\tif !IsModernImageInput(name) {
\t\t\tt.Fatalf("modern image extension not detected: %s", name)
\t\t}
\t}
\tif IsModernImageInput("a.jpg") {
\t\tt.Fatal("jpg must not use modern-image preflight")
\t}
}

func TestModernImageFailureMessage(t *testing.T) {
\terr := ExplainModernImageFailure("IMG_0001.HEIC", errors.New("decoder missing"))
\tfor _, want := range []string{"HEIC", "FFmpeg", "源文件未被修改", "decoder missing"} {
\t\tif !strings.Contains(err.Error(), want) {
\t\t\tt.Fatalf("missing failure detail %q: %v", want, err)
\t\t}
\t}
}
''',
)
write(
    CODE / "cmd/mediaworkbench/v440_source_contract_test.go",
    '''package main

import (
\t"os"
\t"strings"
\t"testing"
)

func TestV440ImageCropSourceContracts(t *testing.T) {
\ttrim, err := os.ReadFile("trim_dialog_windows.go")
\tif err != nil {
\t\tt.Fatal(err)
\t}
\ts := string(trim)
\tfor _, want := range []string{"task.Kind == model.KindImage", "Kind: d.task.Kind", "图片画面裁剪", "拍摄时间与文件时间"} {
\t\tif !strings.Contains(s, want) {
\t\t\tt.Fatalf("missing image crop contract %q", want)
\t\t}
\t}
}
''',
)
write(
    PROJECT / "Mediova_v4.4.0_版本说明.md",
    '''# Mediova v4.4.0 版本说明（候选）

v4.4.0 将 v4.3.0 的画面裁剪工作流扩展到图片，并明确现代图片格式的解码边界。

## 新增能力

- 图片任务使用同一裁剪对话框，跳过无意义的时间范围校验。
- 图片支持自由、16:9、9:16、1:1、4:3 裁剪和批量应用到已选任务。
- 高清处理后预览按任务真实媒体类型生成，不再硬编码为视频。
- HEIC、HEIF、AVIF 在转换前执行有界 FFmpeg 解码预检。
- 当前 FFmpeg 不支持现代图片解码时，给出明确格式、解决方法和“源文件未修改”提示。
- JPG/PNG 继续走原有稳定管线；EXIF、拍摄时间、文件时间和目录时间仍由现有设置与完成链保留。

v4.4.0 通过后继续推进 v4.5.0 长队列恢复与可靠性。
''',
)

subprocess.run(["gofmt", "-w", str(MAIN), str(TRIM), str(FFMPEG), str(CONTRACT), str(CODE / "internal/media/image_input.go"), str(CODE / "internal/media/image_input_test.go"), str(CODE / "cmd/mediaworkbench/v440_source_contract_test.go")], check=True)
refresh_hashes([
    "internal/media/image_input.go",
    "internal/media/image_input_test.go",
    "cmd/mediaworkbench/v440_source_contract_test.go",
])
subprocess.run(["sha256sum", "-c", "SOURCE_FILES_SHA256.txt"], cwd=CODE, check=True)
subprocess.run(["go", "test", "-count=1", "./..."], cwd=CODE, check=True)
subprocess.run(["go", "test", "-race", "-count=1", "./..."], cwd=CODE, check=True)
subprocess.run(["go", "vet", "-unsafeptr=false", "./..."], cwd=CODE, check=True)
env = {**os.environ, "CGO_ENABLED": "0", "GOOS": "windows", "GOARCH": "amd64"}
subprocess.run(["go", "test", "-c", "./cmd/mediaworkbench", "-o", "/tmp/Mediova_v440_tests.exe"], cwd=CODE, env=env, check=True)
subprocess.run(["go", "build", "-buildvcs=false", "-trimpath", "-ldflags=-H=windowsgui -s -w", "-o", "/tmp/Mediova_v440.exe", "./cmd/mediaworkbench"], cwd=CODE, env=env, check=True)
print("P101 Mediova v4.4.0 passed portable gates")
