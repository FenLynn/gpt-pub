from __future__ import annotations

import hashlib
import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[5]
CODE = REPO / "projects/1-桌面软件/101-Mediova/代码"
CMD = CODE / "cmd/mediaworkbench"


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement, found {count}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")


def replace_regex_once(path: Path, pattern: str, replacement: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, lambda _m: replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{path}: expected one regex replacement, found {count}: {pattern[:120]!r}")
    path.write_text(updated, encoding="utf-8", newline="\n")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    main_file = CMD / "main_windows.go"
    v420 = CMD / "v420_windows.go"
    harden = CMD / "v420_harden_windows.go"
    v422 = CMD / "v422_windows.go"

    replace_once(
        main_file,
        '''\t\tif r, _, _ := procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc))); r != 0 {
\t\t\tapp.layout(rc.Right-rc.Left, rc.Bottom-rc.Top)
\t\t}
\t\twriteStartupStage("wm_create_layout_complete")
''',
        '''\t\tif r, _, _ := procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc))); r != 0 {
\t\t\tapp.layout(rc.Right-rc.Left, rc.Bottom-rc.Top)
\t\t}
\t\tv452FinalizeInitialToolbar(app)
\t\twriteStartupStage("wm_create_layout_complete")
''',
    )

    replace_regex_once(
        main_file,
        r'\tglyph := "\\uE768"\n\tif dis\.HwndItem != a\.hStart \{\n\t\tglyph = secondaryButtonGlyph\(dis\.HwndItem\)\n\t\}\n\tlabel := getText\(dis\.HwndItem\)\n',
        '\tlabel := getText(dis.HwndItem)\n',
    )
    replace_once(
        main_file,
        '''\tdrawCenteredText(dis.HDC, glyph, iconRC, iconFont, textColor)
\tdrawCenteredText(dis.HDC, label, textRC, font, textColor)
''',
        '''\tv452DrawSolidPrimaryGlyph(dis.HDC, dis.HwndItem, iconRC, textColor)
\tdrawCenteredText(dis.HDC, label, textRC, font, textColor)
''',
    )

    replace_regex_once(
        main_file,
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
\t\t\t\tdrawHorizontalGradient(dis.HDC, fill, colorRef(235, 237, 240), colorRef(194, 199, 207))
\t\t\t} else {
\t\t\t\tdrawHorizontalGradient(dis.HDC, fill, colorRef(151, 196, 245), colorRef(58, 122, 214))
\t\t\t}
\t\t}
\t})
\tdrawRoundedBorder(dis.HDC, bar, 4, colorRef(218, 223, 230))
\tif a.overallPaused {
\t\tv452DrawPausedProgressText(dis.HDC, a.overallText, bar)
\t} else {
\t\tdrawContrastCenteredText(dis.HDC, a.overallText, bar, fill, uiFontSmall)
\t}
\treturn true
}

func (a *application) drawDecoration''',
    )

    replace_once(
        main_file,
        '''\tduration := runEnded.Sub(runStarted)
\tif duration < 0 {
\t\tduration = 0
\t}
''',
        '''\tduration := v452FinishRunClock(a, runStarted, runEnded)
''',
    )

    replace_regex_once(
        main_file,
        r'func \(a \*application\) refreshTotal\(\) \{.*?\n\}\n\nfunc prepareTaskForRetry',
        '''func (a *application) refreshTotal() {
\ta.runMu.Lock()
\trunning := a.running
\tpaused := a.paused
\tstart := a.runStart
\trunKind := a.runKind
\trunIDs := copyTaskIDSet(a.runTaskIDs)
\ta.runMu.Unlock()

\tnow := time.Now()
\tactiveElapsed := time.Duration(0)
\tif running {
\t\tactiveElapsed = v452RunElapsed(a, start, now)
\t}
\tdisplayKind := a.currentKind
\tdisplayRunning := running && displayKind == runKind
\tvar displayIDs map[int64]bool
\tdisplayElapsed := time.Duration(0)
\tif displayRunning {
\t\tdisplayIDs = runIDs
\t\tdisplayElapsed = activeElapsed
\t}
\tdisplay := a.v422SummarizeProgress(displayKind, displayIDs)
\tpct, text, elapsed, remaining, speed := display.render(displayKind, displayRunning, displayElapsed, displayRunning && paused, a.settings.ShowPerformanceStats)
\tpausedDisplay := displayRunning && paused
\tredraw := v452ShouldInvalidateProgress(a.overallProgress, pct, a.overallText, text, a.overallPaused, pausedDisplay)
\ta.overallProgress = pct
\ta.overallText = text
\ta.overallPaused = pausedDisplay
\tif redraw {
\t\tprocInvalidateRect.Call(a.hProgress, 0, 0)
\t}

\tif running {
\t\trunSummary := display
\t\tif !displayRunning {
\t\t\trunSummary = a.v422SummarizeProgress(runKind, runIDs)
\t\t}
\t\trunPct, _, runElapsed, runRemaining, runSpeed := runSummary.render(runKind, true, activeElapsed, paused, a.settings.ShowPerformanceStats)
\t\ta.updateFloatingBar(runPct, floatingProgressText(runPct, runSummary.Completed, runSummary.Total, runElapsed, runRemaining, runSpeed, runSummary.Active, runSummary.Engine, paused), true)
\t} else {
\t\ta.updateFloatingBar(pct, floatingProgressText(pct, display.Completed, display.Total, elapsed, remaining, speed, display.Active, display.Engine, false), false)
\t}
}

func prepareTaskForRetry''',
    )

    replace_once(
        v420,
        '''\tsetText(a.hOutputEdit, current)
\tenable(a.hOutputEdit, !a.v420OutputLocked(kind))
\tenable(a.hOutputPick, !a.v420OutputLocked(kind))
''',
        '''\tsetText(a.hOutputEdit, current)
\tlocked := a.v420OutputLocked(kind)
\tenable(a.hOutputEdit, !locked)
\tenable(a.hOutputPick, !locked)
\tv452ClearComboSelection(a, a.hOutputEdit, locked)
''',
    )

    replace_once(
        v420,
        '''\ta.runKind = runKind
\ta.runStart = time.Now()
\ta.timeEnd = time.Time{}
''',
        '''\ta.runKind = runKind
\trunStartedAt := time.Now()
\ta.runStart = runStartedAt
\ta.timeEnd = time.Time{}
''',
    )
    replace_once(
        v420,
        '''\ta.runMu.Unlock()

\tids, skipped, problems := a.v420PrepareReadyBatch(runKind, only)
''',
        '''\ta.runMu.Unlock()
\tv452ResetRunClock(a, runStartedAt)

\tids, skipped, problems := a.v420PrepareReadyBatch(runKind, only)
''',
    )

    replace_once(
        harden,
        '''\ta.runMu.Unlock()

\tvar controlErr error
''',
        '''\ta.runMu.Unlock()
\tv452SetRunPaused(a, paused, time.Now())

\tvar controlErr error
''',
    )

    replace_regex_once(
        v422,
        r'// drawStatusLamp uses.*?func drawStatusLamp\(hdc uintptr, rc rect, color uintptr\) \{.*?\n\}\n',
        '''// drawStatusLamp uses an explicitly square GDI ellipse. Its diameter is
// derived from the status text height and remains circular at every DPI.
func drawStatusLamp(hdc uintptr, rc rect, color uintptr) {
\tv452DrawTrueStatusLamp(hdc, rc, color)
}
''',
    )

    replace_regex_once(
        v422,
        r'func \(summary v422ProgressSummary\) render\(kind model.Kind, running bool, start time.Time, paused, showStats bool\) \(float64, string, time.Duration, time.Duration, string\) \{.*?\n\}\n$',
        '''func (summary v422ProgressSummary) render(kind model.Kind, running bool, elapsed time.Duration, paused, showStats bool) (float64, string, time.Duration, time.Duration, string) {
\tpct := 0.0
\tif summary.Total > 0 {
\t\tpct = summary.Sum / float64(summary.Total)
\t}
\tpct = clamp01(pct/100) * 100
\ttext := fmt.Sprintf("已完成 %d/%d · 总进度 %.1f%%", summary.Completed, summary.Total, pct)
\tvar remaining time.Duration
\tspeed := "—"
\tif running {
\t\tif elapsed < 0 {
\t\t\telapsed = 0
\t\t}
\t\ttext += " · 已用 " + formatDuration(elapsed)
\t\tif pct > .2 && pct < 100 && elapsed > 0 {
\t\t\testimate := time.Duration(float64(elapsed) * 100 / pct)
\t\t\tremaining = estimate - elapsed
\t\t\tif remaining > 0 {
\t\t\t\ttext += " · 剩余 " + formatDuration(remaining)
\t\t\t}
\t\t}
\t\tif elapsed.Seconds() > 0 {
\t\t\tif kind == model.KindVideo {
\t\t\t\tspeed = fmt.Sprintf("%.2fx", summary.ProcessedVideo/elapsed.Seconds())
\t\t\t} else if elapsed.Minutes() > 0 {
\t\t\t\tspeed = fmt.Sprintf("%.0f 张/分", summary.ProcessedImages/elapsed.Minutes())
\t\t\t}
\t\t}
\t\tif showStats {
\t\t\ttext += " · 速度 " + speed
\t\t\tif summary.TotalInput > 0 {
\t\t\t\ttext += " · " + media.FormatBytes(summary.TotalInput) + " → " + media.FormatBytes(summary.TotalOutput)
\t\t\t}
\t\t}
\t\tif paused {
\t\t\ttext += " · 已暂停"
\t\t}
\t}
\tif summary.Failed > 0 {
\t\ttext += fmt.Sprintf(" · 失败 %d", summary.Failed)
\t}
\treturn pct, text, elapsed, remaining, speed
}
''',
    )

    go_files = [
        CMD / "v452_runtime_clock.go",
        CMD / "v452_runtime_clock_test.go",
        CMD / "v452_ui_state_windows.go",
        CMD / "v452_ui_state_source_test.go",
        main_file,
        v420,
        harden,
        v422,
    ]
    subprocess.run(["gofmt", "-w", *map(str, go_files)], check=True)

    round_paths = [
        "cmd/mediaworkbench/main_windows.go",
        "cmd/mediaworkbench/v420_windows.go",
        "cmd/mediaworkbench/v420_harden_windows.go",
        "cmd/mediaworkbench/v422_windows.go",
        "cmd/mediaworkbench/v452_runtime_clock.go",
        "cmd/mediaworkbench/v452_runtime_clock_test.go",
        "cmd/mediaworkbench/v452_ui_state_windows.go",
        "cmd/mediaworkbench/v452_ui_state_source_test.go",
    ]
    manifest = CODE / "V452_ROUND1_UI_STATE_FILES_SHA256.txt"
    manifest.write_text(
        "\n".join(f"{sha(CODE / rel)}  {rel}" for rel in round_paths) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    manifest_hash = sha(manifest)

    manifest_test = CMD / "v452_round1_manifest_test.go"
    manifest_test.write_text(
        f'''package main

import (
\t"bufio"
\t"crypto/sha256"
\t"encoding/hex"
\t"os"
\t"path/filepath"
\t"strings"
\t"testing"
)

const v452Round1ManifestSHA256 = "{manifest_hash}"

func TestV452Round1FixedManifest(t *testing.T) {{
\tmanifest := filepath.Join("..", "..", "V452_ROUND1_UI_STATE_FILES_SHA256.txt")
\tdata, err := os.ReadFile(manifest)
\tif err != nil {{
\t\tt.Fatal(err)
\t}}
\tsum := sha256.Sum256(data)
\tif got := hex.EncodeToString(sum[:]); got != v452Round1ManifestSHA256 {{
\t\tt.Fatalf("manifest sha256=%s want=%s", got, v452Round1ManifestSHA256)
\t}}
\tscanner := bufio.NewScanner(strings.NewReader(string(data)))
\tfor scanner.Scan() {{
\t\tparts := strings.Fields(scanner.Text())
\t\tif len(parts) != 2 {{
\t\t\tt.Fatalf("invalid manifest row %q", scanner.Text())
\t\t}}
\t\tfileData, err := os.ReadFile(filepath.Join("..", "..", filepath.FromSlash(parts[1])))
\t\tif err != nil {{
\t\t\tt.Fatalf("%s: %v", parts[1], err)
\t\t}}
\t\tfileSum := sha256.Sum256(fileData)
\t\tif got := hex.EncodeToString(fileSum[:]); got != parts[0] {{
\t\t\tt.Fatalf("%s sha256=%s want=%s", parts[1], got, parts[0])
\t\t}}
\t}}
\tif err := scanner.Err(); err != nil {{
\t\tt.Fatal(err)
\t}}
}}
''',
        encoding="utf-8",
        newline="\n",
    )
    subprocess.run(["gofmt", "-w", str(manifest_test)], check=True)

    source_manifest = CODE / "SOURCE_FILES_SHA256.txt"
    source_paths: set[str] = set(round_paths)
    source_paths.update(
        {
            "cmd/mediaworkbench/v452_round1_manifest_test.go",
            "V452_ROUND1_UI_STATE_FILES_SHA256.txt",
        }
    )
    for line in source_manifest.read_text(encoding="utf-8").splitlines():
        parts = line.strip().split(maxsplit=1)
        if len(parts) == 2:
            source_paths.add(parts[1])
    source_manifest.write_text(
        "\n".join(f"{sha(CODE / rel)}  {rel}" for rel in sorted(source_paths)) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    for temporary in [
        REPO / ".github/workflows/p101-v452-round1-apply.yml",
        REPO / ".github/workflows/p101-v452-round1-pr-apply.yml",
        Path(__file__),
    ]:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
