from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAIN = ROOT / "cmd/mediaworkbench/main_windows.go"
HELPER = ROOT / "cmd/mediaworkbench/adaptive_layout.go"
HELPER_TEST = ROOT / "cmd/mediaworkbench/adaptive_layout_test.go"
WINDOWS_AUDIT = ROOT / "cmd/mediaworkbench/adaptive_layout_audit_windows_test.go"
HASHES = ROOT / "SOURCE_FILES_SHA256.txt"


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one replacement, got {count}")
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
        path = ROOT / rel
        if not path.is_file():
            raise SystemExit(f"hash source path missing: {rel}")
        rows.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {rel}")
    HASHES.write_text("\n".join(rows) + "\n", encoding="utf-8", newline="\n")


old = '''\t\tdetailsY := actionY + 114
\t\tdetailsH := top + listH - detailsY
\t\tif detailsH < 90 {
\t\t\tdetailsH = 90
\t\t}
\t\tmove(a.hDetailsFrame, rightX+2, detailsY, rightW-14, detailsH)
\t\tmove(a.hDetails, rightX+10, detailsY+8, rightW-30, detailsH-16)
'''
new = '''\t\tdetailsY := actionY + 114
\t\tdetailsH, detailsVisible := rightDetailsHeightFor(top+listH, detailsY)
\t\tshow(a.hDetailsFrame, detailsVisible)
\t\tshow(a.hDetails, detailsVisible)
\t\tif detailsVisible {
\t\t\tmove(a.hDetailsFrame, rightX+2, detailsY, rightW-14, detailsH)
\t\t\tmove(a.hDetails, rightX+10, detailsY+8, rightW-30, detailsH-16)
\t\t}
'''
replace_once(MAIN, old, new)

write(
    HELPER,
    '''package main

const rightDetailsMinHeight int32 = 90

// rightDetailsHeightFor returns a usable details height only when the complete
// secondary details panel fits above the bottom parameter area. Primary queue
// controls remain visible; the details panel is the first element to collapse.
func rightDetailsHeightFor(listBottom, detailsY int32) (int32, bool) {
\tavailable := listBottom - detailsY
\tif available < rightDetailsMinHeight {
\t\treturn 0, false
\t}
\treturn available, true
}
''',
)

write(
    HELPER_TEST,
    '''package main

import "testing"

func TestRightDetailsHeightCollapsesBeforeOverlap(t *testing.T) {
\ttests := []struct {
\t\tname       string
\t\tlistBottom int32
\t\tdetailsY   int32
\t\twantHeight int32
\t\twantShown  bool
\t}{
\t\t{"negative", 400, 418, 0, false},
\t\t{"short", 456, 418, 0, false},
\t\t{"boundary-below", 507, 418, 0, false},
\t\t{"boundary", 508, 418, 90, true},
\t\t{"expanded", 620, 418, 202, true},
\t}
\tfor _, tc := range tests {
\t\tt.Run(tc.name, func(t *testing.T) {
\t\t\theight, shown := rightDetailsHeightFor(tc.listBottom, tc.detailsY)
\t\t\tif height != tc.wantHeight || shown != tc.wantShown {
\t\t\t\tt.Fatalf("height=%d shown=%v, want height=%d shown=%v", height, shown, tc.wantHeight, tc.wantShown)
\t\t\t}
\t\t\tif shown && tc.detailsY+height > tc.listBottom {
\t\t\t\tt.Fatalf("visible details exceed list bottom: y=%d h=%d bottom=%d", tc.detailsY, height, tc.listBottom)
\t\t\t}
\t\t})
\t}
}

func TestRightDetailsHeightContinuousHeightMatrix(t *testing.T) {
\tfor clientH := int32(620); clientH <= 1200; clientH++ {
\t\tfor _, compactBottom := range []bool{false, true} {
\t\t\tbottomBarH := int32(126)
\t\t\tif compactBottom {
\t\t\t\tbottomBarH = 164
\t\t\t}
\t\t\tconst top int32 = 68
\t\t\tlistH := clientH - top - bottomBarH
\t\t\tif listH < 260 {
\t\t\t\tlistH = 260
\t\t\t}
\t\t\tdetailsY := top + 40 + 5*38 + 6 + 114
\t\t\tlistBottom := top + listH
\t\t\theight, shown := rightDetailsHeightFor(listBottom, detailsY)
\t\t\tavailable := listBottom - detailsY
\t\t\tif shown {
\t\t\t\tif height < rightDetailsMinHeight || detailsY+height != listBottom {
\t\t\t\t\tt.Fatalf("h=%d compact=%v visible geometry invalid: available=%d height=%d", clientH, compactBottom, available, height)
\t\t\t\t}
\t\t\t} else if available >= rightDetailsMinHeight {
\t\t\t\tt.Fatalf("h=%d compact=%v hid usable details space=%d", clientH, compactBottom, available)
\t\t\t}
\t\t}
\t}
}
''',
)

write(
    WINDOWS_AUDIT,
    '''//go:build windows

package main

import (
\t"testing"

\t"mediaworkbench/internal/model"
)

func TestAdaptiveTopBandContinuousWidthBudget(t *testing.T) {
\tfor width := int32(900); width <= 1920; width++ {
\t\tband := topBandForWidth(width)
\t\ttoolbarRight := toolbarRightEdge(band)
\t\ttoggleW := int32(22)
\t\tif width < 1120 {
\t\t\ttoggleW = 20
\t\t}
\t\ttoggleX := width - 8 - toggleW
\t\tstatusGridX := toggleX - 7 - band.statusGridW
\t\tfilterX := statusGridX - 8 - band.filterW
\t\tsearchLeft := toolbarRight + 8
\t\tsearchRight := filterX - 7
\t\tif searchRight-searchLeft < 90 {
\t\t\tt.Fatalf("width=%d leaves insufficient search space: left=%d right=%d", width, searchLeft, searchRight)
\t\t}
\t\tif toolbarRight >= searchLeft || searchRight >= filterX || filterX+band.filterW > statusGridX {
\t\t\tt.Fatalf("width=%d top-band order invalid", width)
\t\t}
\t}
}

func TestAdaptiveRightPanelContinuousWidthBudget(t *testing.T) {
\tfor width := int32(900); width <= 1920; width++ {
\t\trightW := int32(264)
\t\tif width < 1180 {
\t\t\trightW = 238
\t\t}
\t\tlistW := width - rightW - 24
\t\tif listW < 520 {
\t\t\tlistW = 520
\t\t}
\t\trightX := int32(16) + listW
\t\tif rightX < 0 || rightX+rightW > width-8 {
\t\t\tt.Fatalf("width=%d right panel outside client: x=%d w=%d", width, rightX, rightW)
\t\t}
\t}
}

func TestAdaptiveBottomParameterContinuousWidthBudget(t *testing.T) {
\tfor width := int32(900); width <= 1920; width++ {
\t\tfor _, kind := range []model.Kind{model.KindVideo, model.KindImage} {
\t\t\twidths := bottomParameterWidths(kind)
\t\t\tif width < 1320 {
\t\t\t\tx := int32(8)
\t\t\t\tfor _, fieldW := range []int32{widths.Resolution, widths.Codec, widths.Quality, widths.Volume, widths.Rotation} {
\t\t\t\t\tx += 38 + fieldW + 6
\t\t\t\t}
\t\t\t\tremaining := width - x - 8
\t\t\t\tif remaining < 124 {
\t\t\t\t\tt.Fatalf("width=%d kind=%v compact parameter row remaining=%d", width, kind, remaining)
\t\t\t\t}
\t\t\t\tcontinue
\t\t\t}
\t\t\tfixedBottomW := int32(38) + widths.Resolution + 7 + 34 + widths.Codec + 7 + 34 + widths.Quality + 7 + 34 + widths.Volume + 7 + 34 + widths.Rotation + 8 + 124
\t\t\teditW := width - 8 - 116 - 6 - 60 - 8 - fixedBottomW - 8
\t\t\tif editW < 210 {
\t\t\t\tt.Fatalf("width=%d kind=%v output edit width=%d", width, kind, editW)
\t\t\t}
\t\t}
\t}
}
''',
)

refresh_hashes(
    [
        "cmd/mediaworkbench/main_windows.go",
        "cmd/mediaworkbench/adaptive_layout.go",
        "cmd/mediaworkbench/adaptive_layout_test.go",
        "cmd/mediaworkbench/adaptive_layout_audit_windows_test.go",
    ]
)
print("adaptive layout patch installed")
