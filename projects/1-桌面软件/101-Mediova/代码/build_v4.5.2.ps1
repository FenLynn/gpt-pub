param(
    [string]$FFmpegBin = "",
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$version = "4.5.2"
$buildRoot = Join-Path $PSScriptRoot "build"
$runtimeRoot = Join-Path $buildRoot "Runtime"
$componentBin = Join-Path $runtimeRoot "Components/FFmpeg/bin"
$versionSource = Join-Path $PSScriptRoot "cmd/mediaworkbench/main_windows.go"
if (Test-Path $buildRoot) { Remove-Item $buildRoot -Recurse -Force }
New-Item $runtimeRoot -ItemType Directory -Force | Out-Null

if (-not $SkipTests) {
    $testDataRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("MediovaBuildTest-" + [guid]::NewGuid().ToString("N"))
    New-Item $testDataRoot -ItemType Directory -Force | Out-Null
    $oldLocalAppData = $env:LOCALAPPDATA
    $oldAppData = $env:APPDATA
    $oldXdgConfigHome = $env:XDG_CONFIG_HOME
    $oldRuntime = $env:MEDIOVA_RUNTIME_DIR
    try {
        $env:LOCALAPPDATA = $testDataRoot
        $env:APPDATA = $testDataRoot
        $env:XDG_CONFIG_HOME = $testDataRoot
        $env:MEDIOVA_RUNTIME_DIR = (Join-Path $testDataRoot "Runtime")
        go test -count=1 ./...
        if ($LASTEXITCODE -ne 0) { throw "go test failed" }
    } finally {
        $env:LOCALAPPDATA = $oldLocalAppData
        $env:APPDATA = $oldAppData
        $env:XDG_CONFIG_HOME = $oldXdgConfigHome
        $env:MEDIOVA_RUNTIME_DIR = $oldRuntime
        Remove-Item $testDataRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    go vet -unsafeptr=false ./...
    if ($LASTEXITCODE -ne 0) { throw "go vet failed" }
}

# main_windows.go belongs to the preserved v4.5.0 source baseline. Build the
# v4.5.2 verification executable with a temporary exact replacement, then
# restore the original bytes in finally so the checkout remains auditable.
$originalSourceBytes = [System.IO.File]::ReadAllBytes($versionSource)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$originalSourceText = $utf8NoBom.GetString($originalSourceBytes)
$oldVersionLine = 'const appVersion = "4.5.0"'
$newVersionLine = 'const appVersion = "4.5.2"'
if (-not $originalSourceText.Contains($oldVersionLine)) {
    throw "Expected frozen appVersion declaration was not found: $oldVersionLine"
}
$patchedSourceText = $originalSourceText.Replace($oldVersionLine, $newVersionLine)
try {
    [System.IO.File]::WriteAllText($versionSource, $patchedSourceText, $utf8NoBom)
    go build -buildvcs=false -trimpath -ldflags='-H=windowsgui -s -w' -o (Join-Path $buildRoot "Mediova_raw.exe") ./cmd/mediaworkbench
    if ($LASTEXITCODE -ne 0) { throw "go build failed" }
    python tools_embed_resources.py assets/v2.8.4_resources.mwrsrc (Join-Path $buildRoot "Mediova_raw.exe") (Join-Path $runtimeRoot "Mediova.exe") --version $version
    if ($LASTEXITCODE -ne 0) { throw "resource embedding failed" }
} finally {
    [System.IO.File]::WriteAllBytes($versionSource, $originalSourceBytes)
}
Remove-Item (Join-Path $buildRoot "Mediova_raw.exe") -Force

if ([string]::IsNullOrWhiteSpace($FFmpegBin)) {
    $ffmpeg = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
    $ffprobe = Get-Command ffprobe.exe -ErrorAction SilentlyContinue
    if ($ffmpeg -and $ffprobe -and $ffmpeg.Source -and $ffprobe.Source) {
        $FFmpegBin = Split-Path $ffmpeg.Source -Parent
    }
}
if (-not [string]::IsNullOrWhiteSpace($FFmpegBin)) {
    $ffmpegExe = Join-Path $FFmpegBin "ffmpeg.exe"
    $ffprobeExe = Join-Path $FFmpegBin "ffprobe.exe"
    if (!(Test-Path $ffmpegExe) -or !(Test-Path $ffprobeExe)) {
        throw "FFmpegBin must contain ffmpeg.exe and ffprobe.exe: $FFmpegBin"
    }
    New-Item $componentBin -ItemType Directory -Force | Out-Null
    Get-ChildItem $FFmpegBin -File | Where-Object {
        $_.Name -ieq "ffmpeg.exe" -or $_.Name -ieq "ffprobe.exe" -or $_.Extension -ieq ".dll"
    } | Copy-Item -Destination $componentBin -Force
}

$notice = @"
# Third-party notices

Mediova uses FFmpeg/FFprobe when the corresponding Runtime components are present.
FFmpeg is a separate project and is not owned by Mediova.

- Project: FFmpeg
- Homepage: https://ffmpeg.org/
- Source and license information: https://ffmpeg.org/legal.html
- The exact binary version and build configuration can be displayed with `Components\\FFmpeg\\bin\\ffmpeg.exe -version`.

The Runtime/Data boundary is:

- Runtime: Mediova.exe, Components, notices and runtime-manifest.json.
- Roaming Data: configuration, history, session and backups.
- Local Data: cache, temporary files, thumbnails, logs, state and crash reports.

Runtime updates must never contain user Data.
"@
Set-Content (Join-Path $runtimeRoot "THIRD_PARTY_NOTICES.md") $notice -Encoding UTF8

$runtimeReadme = @"
Mediova v$version Verification Runtime

Run Mediova.exe directly from this folder.
Do not move only Mediova.exe away from Components when using the bundled FFmpeg.
User configuration and history are stored outside Runtime under AppData, unless portable.mode is enabled.
This is a v4.5.2 verification candidate; it does not change the official v4.5.0 tag or Release.
"@
Set-Content (Join-Path $runtimeRoot "README.txt") $runtimeReadme -Encoding UTF8

$files = @()
Get-ChildItem $runtimeRoot -Recurse -File | Where-Object { $_.Name -ne "runtime-manifest.json" } | Sort-Object FullName | ForEach-Object {
    $relative = [System.IO.Path]::GetRelativePath($runtimeRoot, $_.FullName).Replace('\\','/')
    $files += [ordered]@{
        path = $relative
        size = [int64]$_.Length
        sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
$manifest = [ordered]@{
    product = "Mediova"
    version = $version
    channel = "verification-candidate"
    platform = "Windows x64"
    deployment = "folder-runtime"
    files = $files
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $runtimeRoot "runtime-manifest.json") -Encoding UTF8

$zip = Join-Path $buildRoot "Mediova-v$version-Verification-Runtime.zip"
Compress-Archive -Path (Join-Path $runtimeRoot "*") -DestinationPath $zip -CompressionLevel Optimal -Force
$exeHash = (Get-FileHash (Join-Path $runtimeRoot "Mediova.exe") -Algorithm SHA256).Hash.ToLowerInvariant()
$zipHash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
@(
    "$exeHash  Runtime/Mediova.exe",
    "$zipHash  Mediova-v$version-Verification-Runtime.zip"
) | Set-Content (Join-Path $buildRoot "SHA256.txt") -Encoding Ascii
Write-Host "Built $zip"
Write-Host "Mediova.exe SHA-256: $exeHash"
Write-Host "Runtime ZIP SHA-256: $zipHash"
