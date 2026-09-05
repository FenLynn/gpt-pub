param(
    [string]$FFmpegBin = "",
    [string]$ExifToolRoot = "",
    [string]$OutputDirectory = "build-v4.5.5-next",
    [switch]$PackageZip,
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "build_v4.5.4.ps1") `
    -ReleaseVersion "4.5.5" `
    -FFmpegBin $FFmpegBin `
    -ExifToolRoot $ExifToolRoot `
    -OutputDirectory $OutputDirectory `
    -PackageZip:$PackageZip `
    -SkipTests:$SkipTests
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
