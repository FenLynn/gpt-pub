from pathlib import Path
import os
import time
import urllib.request
import zipfile

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
text = text.replace(old, new, 1)
old_env = '''\tt.Setenv("XDG_CONFIG_HOME", t.TempDir())
'''
new_env = '''\troot := t.TempDir()
\tt.Setenv("XDG_CONFIG_HOME", root)
\tt.Setenv("APPDATA", root)
\tt.Setenv("LOCALAPPDATA", root)
'''
if old_env not in text:
    raise SystemExit("history test isolation marker not found")
text = text.replace(old_env, new_env, 1)
test.write_text(text, encoding="utf-8", newline="\n")

ui_test = Path("projects/1-桌面软件/101-Mediova/代码/cmd/mediaworkbench/ui_rules_test.go")
text = ui_test.read_text(encoding="utf-8")
text = text.replace(
    "compressionVisualFor(100, 260)",
    "compressionVisualFor(10*1024*1024, 26*1024*1024)",
)
ui_test.write_text(text, encoding="utf-8", newline="\n")

# GitHub Actions occasionally cannot reach Chocolatey. Prepare a real, public
# Windows x64 FFmpeg pair from BtbN's stable floating GitHub Release URL and
# expose its bin directory to subsequent workflow steps.
if os.environ.get("GITHUB_ACTIONS", "").lower() == "true":
    runner_temp = Path(os.environ.get("RUNNER_TEMP", "."))
    archive = runner_temp / "btbn-ffmpeg-win64-gpl.zip"
    expanded = runner_temp / "btbn-ffmpeg-win64-gpl"
    url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    if expanded.exists():
        import shutil
        shutil.rmtree(expanded)
    expanded.mkdir(parents=True, exist_ok=True)
    error = None
    for attempt in range(1, 4):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Mediova-v4.1.0-CI"})
            with urllib.request.urlopen(request, timeout=300) as response, archive.open("wb") as output:
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    output.write(block)
            error = None
            break
        except Exception as exc:
            error = exc
            if archive.exists():
                archive.unlink()
            if attempt < 3:
                time.sleep(5 * attempt)
    if error is not None:
        raise SystemExit(f"failed to download BtbN FFmpeg after retries: {error}")
    with zipfile.ZipFile(archive) as package:
        package.extractall(expanded)
    ffmpeg = next((p for p in expanded.rglob("ffmpeg.exe") if p.is_file()), None)
    ffprobe = next((p for p in expanded.rglob("ffprobe.exe") if p.is_file()), None)
    if ffmpeg is None or ffprobe is None or ffmpeg.parent != ffprobe.parent:
        raise SystemExit(f"BtbN package did not contain a colocated FFmpeg pair: {ffmpeg}, {ffprobe}")
    github_path = os.environ.get("GITHUB_PATH")
    if not github_path:
        raise SystemExit("GITHUB_PATH is unavailable")
    with open(github_path, "a", encoding="utf-8") as path_file:
        path_file.write(str(ffmpeg.parent) + "\n")
    print(f"Prepared BtbN FFmpeg tools from {url}: {ffmpeg.parent}")

print("Applied Mediova v4.1.0 post transformation corrections.")
