from pathlib import Path

main = Path("projects/1-桌面软件/101-Mediova/代码/cmd/mediaworkbench/main_windows.go")
text = main.read_text(encoding="utf-8")
text = text.replace("Components\\FFmpeg 目录。", "Components\\\\FFmpeg 目录。")
text = text.replace(
    "bar := rect{Left: rc.Left + 2, Top: rc.Top + 6, Right: rc.Right - 2, Bottom: rc.Bottom - 6}",
    "bar := rect{Left: rc.Left + 2, Top: rc.Top + 5, Right: rc.Right - 2, Bottom: rc.Bottom - 5}",
)
main.write_text(text, encoding="utf-8", newline="\n")

test = Path("projects/1-桌面软件/101-Mediova/代码/internal/media/recovery_features_test.go")
text = test.read_text(encoding="utf-8")
old = '''\tcleanRoot := strings.ToLower(filepath.Clean(dataRoot))
\tif !strings.HasPrefix(strings.ToLower(filepath.Clean(ff)), cleanRoot) || !strings.HasPrefix(strings.ToLower(filepath.Clean(fp)), cleanRoot) {
\t\tt.Fatalf("test escaped isolated data root: ffmpeg=%s ffprobe=%s root=%s", ff, fp, dataRoot)
\t}
'''
new = '''\tcleanRoot := strings.ToLower(filepath.Clean(dataRoot))
\truntimeSuffix := strings.ToLower(filepath.Clean(filepath.Join("Components", "FFmpeg", "bin")))
\tcleanFF := strings.ToLower(filepath.Clean(ff))
\tcleanFP := strings.ToLower(filepath.Clean(fp))
\tif !strings.Contains(cleanFF, runtimeSuffix) || !strings.Contains(cleanFP, runtimeSuffix) {
\t\tt.Fatalf("components were not installed into Runtime: ffmpeg=%s ffprobe=%s", ff, fp)
\t}
\tif strings.HasPrefix(cleanFF, cleanRoot) || strings.HasPrefix(cleanFP, cleanRoot) {
\t\tt.Fatalf("Runtime component leaked into Data: ffmpeg=%s ffprobe=%s root=%s", ff, fp, dataRoot)
\t}
'''
if old not in text:
    raise SystemExit("legacy FFmpeg assertion not found")
test.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")

ui_test = Path("projects/1-桌面软件/101-Mediova/代码/cmd/mediaworkbench/ui_rules_test.go")
text = ui_test.read_text(encoding="utf-8")
text = text.replace(
    "compressionVisualFor(100, 260)",
    "compressionVisualFor(10*1024*1024, 26*1024*1024)",
)
ui_test.write_text(text, encoding="utf-8", newline="\n")

print("Applied Mediova v4.1.0 post transformation corrections.")
