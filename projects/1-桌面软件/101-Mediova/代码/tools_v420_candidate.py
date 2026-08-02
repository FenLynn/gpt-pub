from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
MAIN = ROOT / "cmd" / "mediaworkbench" / "main_windows.go"
PREVIEW = ROOT / "cmd" / "mediaworkbench" / "v420_preview_windows.go"
README = ROOT.parent / "README.md"
CI = ROOT.parents[3] / ".github" / "workflows" / "p101-mediova-ci.yml"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def function_bounds(text: str, signature: str) -> tuple[int, int]:
    start = text.find(signature)
    if start < 0 or text.find(signature, start + 1) >= 0:
        raise RuntimeError(f"{signature}: expected unique signature, found {text.count(signature)}")
    brace = text.find("{", start + len(signature) - 1)
    if brace < 0:
        raise RuntimeError(f"{signature}: opening brace not found")
    depth = 0
    in_string = False
    in_rune = False
    escaped = False
    i = brace
    while i < len(text):
        ch = text[i]
        if escaped:
            escaped = False
        elif ch == "\\" and (in_string or in_rune):
            escaped = True
        elif ch == '"' and not in_rune:
            in_string = not in_string
        elif ch == "'" and not in_string:
            in_rune = not in_rune
        elif not in_string and not in_rune:
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return start, i + 1
        i += 1
    raise RuntimeError(f"{signature}: closing brace not found")


def replace_function(text: str, signature: str, replacement: str) -> str:
    start, end = function_bounds(text, signature)
    return text[:start] + replacement.rstrip() + text[end:]


def patch_function(text: str, signature: str, old: str, new: str, label: str) -> str:
    start, end = function_bounds(text, signature)
    block = text[start:end]
    block = replace_once(block, old, new, label)
    return text[:start] + block + text[end:]


main = MAIN.read_text(encoding="utf-8")
preview = PREVIEW.read_text(encoding="utf-8")
readme = README.read_text(encoding="utf-8")
ci = CI.read_text(encoding="utf-8")

main = replace_once(main, 'const appVersion = "4.1.1"', 'const appVersion = "4.2.0"', "app version")
main = replace_once(main, "\tuiPreview             bool\n}", "\tuiPreview             bool\n\tuiPreviewMode         string\n}", "preview mode field")
main = replace_once(main, "\tuiPreview := parseUIPreviewArgs(os.Args[1:])", "\tuiPreview, uiPreviewMode := parseUIPreviewArgs(os.Args[1:])", "preview parse initialization")
main = replace_once(main, "rightVisible: settings.RightPanelVisible, uiPreview: uiPreview, reservedOutputs:", "rightVisible: settings.RightPanelVisible, uiPreview: uiPreview, uiPreviewMode: uiPreviewMode, reservedOutputs:", "preview mode application init")
main = replace_once(main, "if settings.UILayoutRevision < 411 {\n\t\tsettings.UILayoutRevision = 411", "if settings.UILayoutRevision < 420 {\n\t\tsettings.UILayoutRevision = 420", "layout revision")
main = replace_once(main, 'className := p("MediovaDesktop411")', 'className := p("MediovaDesktop420")', "window class")
main = replace_function(main, "func parseUIPreviewArgs(args []string) bool {", '''func parseUIPreviewArgs(args []string) (bool, string) {
	return parseV420UIPreviewArgs(args)
}''')
main = replace_function(main, "func (a *application) populateUIPreviewTasks() {", '''func (a *application) populateUIPreviewTasks() {
	a.v420PopulateUIPreviewTasks()
}''')
main = patch_function(main, "func (a *application) resetSelfTestRunState() {", "\ta.reservedOutputs = make(map[string]int64)\n\ta.runMu.Unlock()", "\ta.reservedOutputs = make(map[string]int64)\n\ta.v420ResetRunMaps()\n\ta.runMu.Unlock()\n\ta.mu.Lock()\n\ta.heldEditTaskID = 0\n\ta.rightDraftFields = make(map[int]bool)\n\ta.rightSelectionKey = \"\"\n\ta.mu.Unlock()", "self-test v420 reset")
main = replace_once(main, "\ta.showImportToast(\"自检导入：视频 2 个，图片 1 个\")", "\ta.runV420DynamicQueueSelfTest(&report, root, videoPath, ffprobe)\n\ta.showImportToast(\"自检导入：视频 2 个，图片 1 个\")", "dynamic queue self-test call")
main = patch_function(main, "func (a *application) applySmartPlan() {", "if t.Status == model.StatusProcessing || t.Status == model.StatusQueued", "if t.IsLocked()", "smart plan locked guard")

preview = replace_once(preview, 'import (\n\t"fmt"', 'import (\n\t"context"\n\t"fmt"', "preview context import")

readme = replace_once(readme, "当前正式构建入口仍为 v4.1.1：", "v4.2.0 候选完整 Runtime 构建入口：", "README build heading")
readme = replace_once(readme, "./build_v4.1.1.ps1", "./build_v4.2.0.ps1", "README build command")
readme = replace_once(readme, "v4.2.0 构建入口只有在版本实现、资源和完整 Runtime 验证完成后才切换，不提前伪装成正式版本。", "当前正式版本仍为 v4.1.1；上述入口用于 v4.2.0 候选构建，只有完成稳定候选、正式主线准入、标签和 Release 后才成为正式入口。", "README candidate note")

ci = ci.replace("4.1.1", "4.2.0")
ci = ci.replace("build_v4.1.1.ps1", "build_v4.2.0.ps1")
ci = ci.replace("Mediova-v4.1.1", "Mediova-v4.2.0")
ci = ci.replace("P101-Mediova-v4.1.1-CI", "P101-Mediova-v4.2.0-CI")
ci = ci.replace("Mediova-v4.1.1-CI", "Mediova-v4.2.0-CI")
ci = ci.replace("go test -race -count=1 ./internal/config ./internal/media", "go test -race -count=1 ./...")
ci = re.sub(
    r"\s*- name: Capture real Windows UI previews\n.*?(?=\n\s*- name: Run native self-test)",
    r'''
      - name: Capture real Windows UI previews
        shell: pwsh
        working-directory: projects/1-桌面软件/101-Mediova/代码
        run: |
          $ErrorActionPreference='Stop'
          Add-Type -AssemblyName System.Drawing
          Add-Type -AssemblyName System.Windows.Forms
          Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          public static class MediovaCaptureNative {
              [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
              [DllImport("user32.dll", SetLastError=true)] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);
              [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
              [DllImport("user32.dll", SetLastError=true)] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
          }
          "@
          $previewDir=Join-Path $PWD 'build/ui-preview'
          New-Item $previewDir -ItemType Directory -Force | Out-Null
          function Save-MediovaMode([string]$mode, [int]$width, [int]$height, [string]$name) {
            $runtime=Join-Path $PWD 'build/Runtime'
            $exe=Join-Path $runtime 'Mediova.exe'
            $proc=Start-Process -FilePath $exe -WorkingDirectory $runtime -ArgumentList @("--ui-preview=$mode") -PassThru
            try {
              $handle=[IntPtr]::Zero
              for ($i=0; $i -lt 80; $i++) {
                Start-Sleep -Milliseconds 250
                $proc.Refresh()
                if ($proc.HasExited) { throw "Mediova exited before $mode preview capture." }
                if ($proc.MainWindowHandle -ne 0) { $handle=[IntPtr]$proc.MainWindowHandle; break }
              }
              if ($handle -eq [IntPtr]::Zero) { throw "Mediova main window was not created for $mode preview." }
              if (-not [MediovaCaptureNative]::MoveWindow($handle, 0, 0, $width, $height, $true)) { throw "MoveWindow failed for $mode." }
              Start-Sleep -Milliseconds 900
              $rect=New-Object MediovaCaptureNative+RECT
              if (-not [MediovaCaptureNative]::GetWindowRect($handle, [ref]$rect)) { throw "GetWindowRect failed for $mode." }
              $actualWidth=$rect.Right-$rect.Left
              $actualHeight=$rect.Bottom-$rect.Top
              if ([math]::Abs($actualWidth-$width) -gt 8 -or [math]::Abs($actualHeight-$height) -gt 8) { throw "Window was clamped for ${mode}: requested ${width}x${height}, actual ${actualWidth}x${actualHeight}." }
              $path=Join-Path $previewDir $name
              $bmp=New-Object System.Drawing.Bitmap($actualWidth, $actualHeight)
              $graphics=[System.Drawing.Graphics]::FromImage($bmp)
              try {
                $hdc=$graphics.GetHdc()
                try {
                  if (-not [MediovaCaptureNative]::PrintWindow($handle, $hdc, 2)) { throw "PrintWindow failed for $mode." }
                } finally { $graphics.ReleaseHdc($hdc) }
                $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
              } finally { $graphics.Dispose(); $bmp.Dispose() }
              if (!(Test-Path $path) -or (Get-Item $path).Length -lt 10000) { throw "UI preview is missing or too small: $path" }
            } finally {
              if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
            }
          }
          Save-MediovaMode 'video' 1650 930 'Mediova-v4.2.0-video-wide-1650x930.png'
          Save-MediovaMode 'video' 1120 720 'Mediova-v4.2.0-video-compact-1120x720.png'
          Save-MediovaMode 'image' 1450 820 'Mediova-v4.2.0-image-1450x820.png'
          Save-MediovaMode 'held' 1450 820 'Mediova-v4.2.0-held-1450x820.png'
''',
    ci,
    count=1,
    flags=re.S,
)
if "Mediova-v4.2.0-held-1450x820.png" not in ci:
    raise RuntimeError("CI preview step replacement failed")

MAIN.write_text(main, encoding="utf-8")
PREVIEW.write_text(preview, encoding="utf-8")
README.write_text(readme, encoding="utf-8")
CI.write_text(ci, encoding="utf-8")
print("v4.2.0 candidate transform applied")
