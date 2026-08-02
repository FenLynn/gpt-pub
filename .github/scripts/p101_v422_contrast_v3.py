from __future__ import annotations

import hashlib
import re
import subprocess
from pathlib import Path

ROOT = Path.cwd()
CODE = ROOT / "projects/1-桌面软件/101-Mediova/代码"
HELPER = CODE / "cmd/mediaworkbench/v422_windows.go"
CONTRACT = CODE / "cmd/mediaworkbench/v422_source_contract_test.go"
WINAPI = CODE / "cmd/mediaworkbench/winapi_windows.go"
HASHES = CODE / "SOURCE_FILES_SHA256.txt"

text = HELPER.read_text(encoding="utf-8")
if "withRoundedClip(hdc, fill" not in text:
    raise SystemExit("clipping-based contrast renderer is not present")
if '"unsafe"' not in text:
    anchor = '\t"time"\n'
    if text.count(anchor) != 1:
        raise SystemExit("helper import anchor is not unique")
    text = text.replace(anchor, anchor + '\t"unsafe"\n', 1)

pattern = r"// drawContrastCenteredText .*?\nfunc drawContrastCenteredText\(hdc uintptr, text string, bar, fill rect, font uintptr\) \{.*?\n\}\n\nfunc taskDurationText"
replacement = r'''// drawContrastCenteredText measures the complete label, keeps it centred, and
// paints every glyph according to the background under its centre. This avoids
// ListView/PrintWindow clipping inconsistencies while preserving white text on
// blue fill and dark text on the light remainder of partially filled bars.
func drawContrastCenteredText(hdc uintptr, text string, bar, fill rect, font uintptr) {
\tif text == "" {
\t\treturn
\t}
\toldFont, _, _ := procSelectObject.Call(hdc, font)
\tdefer func() {
\t\tif oldFont != 0 {
\t\t\tprocSelectObject.Call(hdc, oldFont)
\t\t}
\t}()
\tprocSetBkMode.Call(hdc, TRANSPARENT)

\tunits := []rune(text)
\twidths := make([]int32, len(units))
\tvar total int32
\tfor i, unit := range units {
\t\tmeasure := rect{Right: 32767, Bottom: bar.Bottom - bar.Top}
\t\tunitText := string(unit)
\t\tprocDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(unitText))), ^uintptr(0), uintptr(unsafe.Pointer(&measure)), DT_LEFT|DT_SINGLELINE|DT_CALCRECT)
\t\twidth := measure.Right - measure.Left
\t\tif width <= 0 {
\t\t\twidth = scaleDPI(8)
\t\t}
\t\twidths[i] = width
\t\ttotal += width
\t}

\tx := bar.Left + (bar.Right-bar.Left-total)/2
\tdark := colorRef(35, 51, 74)
\tlight := colorRef(255, 255, 255)
\tfor i, unit := range units {
\t\twidth := widths[i]
\t\tcolour := dark
\t\tcentre := x + width/2
\t\tif fill.Right > fill.Left && centre >= fill.Left && centre <= fill.Right {
\t\t\tcolour = light
\t\t}
\t\tprocSetTextColor.Call(hdc, colour)
\t\tunitRC := rect{Left: x, Top: bar.Top, Right: x + width + 1, Bottom: bar.Bottom}
\t\tunitText := string(unit)
\t\tprocDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(unitText))), ^uintptr(0), uintptr(unsafe.Pointer(&unitRC)), DT_LEFT|DT_VCENTER|DT_SINGLELINE)
\t\tx += width
\t}
}

func taskDurationText'''.replace("\\t", "\t")
updated, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f"contrast function replacement count={count}")
HELPER.write_text(updated, encoding="utf-8", newline="\n")

winapi = WINAPI.read_text(encoding="utf-8")
if "DT_CALCRECT" not in winapi:
    anchor = "\tDT_SINGLELINE                = 0x00000020\n"
    if winapi.count(anchor) != 1:
        raise SystemExit("DT_CALCRECT anchor is not unique")
    winapi = winapi.replace(anchor, anchor + "\tDT_CALCRECT                  = 0x00000400\n", 1)
WINAPI.write_text(winapi, encoding="utf-8", newline="\n")

contract = CONTRACT.read_text(encoding="utf-8")
old = "`withRoundedClip(hdc, fill, 4`"
if contract.count(old) != 1:
    raise SystemExit(f"old clipping contract count={contract.count(old)}")
contract = contract.replace(old, "`for i, unit := range units`, `DT_LEFT|DT_SINGLELINE|DT_CALCRECT`, `centre >= fill.Left && centre <= fill.Right`", 1)
anchor = "if !strings.Contains(rules, `kind == model.KindImage`)"
if contract.count(anchor) != 1:
    raise SystemExit("contract tail anchor is not unique")
contract = contract.replace(
    anchor,
    'if strings.Contains(helper, "withRoundedClip(hdc, fill") {\n\t\tt.Fatal("progress text returned to unreliable clipping")\n\t}\n\t' + anchor,
    1,
)
CONTRACT.write_text(contract, encoding="utf-8", newline="\n")

subprocess.run(["gofmt", "-w", str(HELPER), str(CONTRACT), str(WINAPI)], check=True)
paths: list[str] = []
for line in HASHES.read_text(encoding="utf-8").splitlines():
    parts = line.strip().split(maxsplit=1)
    if len(parts) == 2:
        paths.append(parts[1])
refreshed: list[str] = []
for rel in sorted(set(paths)):
    path = CODE / rel
    if not path.is_file():
        raise SystemExit(f"hash source path missing: {rel}")
    refreshed.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {rel}")
HASHES.write_text("\n".join(refreshed) + "\n", encoding="utf-8", newline="\n")

subprocess.run(["sha256sum", "-c", "SOURCE_FILES_SHA256.txt"], cwd=CODE, check=True)
subprocess.run(["go", "test", "-count=1", "./..."], cwd=CODE, check=True)
subprocess.run(["go", "test", "-race", "-count=1", "./..."], cwd=CODE, check=True)
subprocess.run(["go", "vet", "-unsafeptr=false", "./..."], cwd=CODE, check=True)
subprocess.run(["go", "test", "-c", "./cmd/mediaworkbench", "-o", "/tmp/Mediova_v422_contrast_v3_tests.exe"], cwd=CODE, check=True, env={**__import__("os").environ, "CGO_ENABLED": "0", "GOOS": "windows", "GOARCH": "amd64"})
subprocess.run(["go", "build", "-buildvcs=false", "-trimpath", "-ldflags=-H=windowsgui -s -w", "-o", "/tmp/Mediova_v422_contrast_v3.exe", "./cmd/mediaworkbench"], cwd=CODE, check=True, env={**__import__("os").environ, "CGO_ENABLED": "0", "GOOS": "windows", "GOARCH": "amd64"})
print("P101 v4.2.2 per-glyph contrast v3 passed portable gates")
