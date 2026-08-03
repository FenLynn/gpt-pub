param(
    [string]$FFmpegBin = "",
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$version = "4.5.1"
$sourceVersion = "4.5.0"
$buildRoot = Join-Path $PSScriptRoot "build-v4.5.1-verification"
$runtimeRoot = Join-Path $buildRoot "Runtime"
$componentBin = Join-Path $runtimeRoot "Components/FFmpeg/bin"
$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("Mediova-v451-stage-" + [guid]::NewGuid().ToString("N"))

if (Test-Path $buildRoot) { Remove-Item $buildRoot -Recurse -Force }
New-Item $runtimeRoot -ItemType Directory -Force | Out-Null
New-Item $stageRoot -ItemType Directory -Force | Out-Null

try {
    Get-ChildItem $PSScriptRoot -Force | Where-Object {
        $_.Name -notin @("build", "build-v4.5.1-verification")
    } | Copy-Item -Destination $stageRoot -Recurse -Force

    $mainPath = Join-Path $stageRoot "cmd/mediaworkbench/main_windows.go"
    $mainText = Get-Content $mainPath -Raw
    $needle = 'const appVersion = "4.5.0"'
    $replacement = 'const appVersion = "4.5.1"'
    $matches = ([regex]::Matches($mainText, [regex]::Escape($needle))).Count
    if ($matches -ne 1) {
        throw "Expected exactly one source version marker, found $matches"
    }
    $mainText = $mainText.Replace($needle, $replacement)
    Set-Content $mainPath $mainText -Encoding UTF8 -NoNewline

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
            Push-Location $stageRoot
            go test -count=1 ./...
            if ($LASTEXITCODE -ne 0) { throw "go test failed" }
            go vet -unsafeptr=false ./...
            if ($LASTEXITCODE -ne 0) { throw "go vet failed" }
            Pop-Location
        } finally {
            if ((Get-Location).Path -eq $stageRoot) { Pop-Location }
            $env:LOCALAPPDATA = $oldLocalAppData
            $env:APPDATA = $oldAppData
            $env:XDG_CONFIG_HOME = $oldXdgConfigHome
            $env:MEDIOVA_RUNTIME_DIR = $oldRuntime
            Remove-Item $testDataRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Push-Location $stageRoot
    go build -buildvcs=false -trimpath -ldflags='-H=windowsgui -s -w' -o (Join-Path $buildRoot "Mediova_raw.exe") ./cmd/mediaworkbench
    if ($LASTEXITCODE -ne 0) { throw "go build failed" }
    Pop-Location

    python (Join-Path $stageRoot "tools_embed_resources.py") (Join-Path $stageRoot "assets/v2.8.4_resources.mwrsrc") (Join-Path $buildRoot "Mediova_raw.exe") (Join-Path $runtimeRoot "Mediova.exe") --version $version
    if ($LASTEXITCODE -ne 0) { throw "resource embedding failed" }
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

Runtime updates must never contain user configuration, history, sessions or other private Data.
"@
    Set-Content (Join-Path $runtimeRoot "THIRD_PARTY_NOTICES.md") $notice -Encoding UTF8

    $runtimeReadme = @"
Mediova v$version Verification Runtime

This build is prepared for user validation before formal release.
Run Mediova.exe directly from this folder.
Do not move only Mediova.exe away from Components when using the bundled FFmpeg.
Existing v4.5.0 configuration, history and session data are inherited automatically.
User Data remains under AppData unless portable.mode is enabled.
"@
    Set-Content (Join-Path $runtimeRoot "README.txt") $runtimeReadme -Encoding UTF8

    $sourceCommit = "unknown"
    try {
        $sourceCommit = (git -C $PSScriptRoot rev-parse HEAD).Trim()
    } catch {}
    if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_SHA)) {
        $sourceCommit = $env:GITHUB_SHA
    }
    $provenance = [ordered]@{
        product = "Mediova"
        artifact_version = $version
        source_declared_version = $sourceVersion
        channel = "verification"
        source_commit = $sourceCommit
        version_stamp = "isolated staged-source replacement"
        built_at_utc = [DateTime]::UtcNow.ToString("o")
    }
    $provenance | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $runtimeRoot "build-provenance.json") -Encoding UTF8

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
        channel = "verification"
        platform = "Windows x64"
        deployment = "folder-runtime"
        source_commit = $sourceCommit
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
} finally {
    if ((Get-Location).Path -eq $stageRoot) { Pop-Location }
    Remove-Item $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
}
