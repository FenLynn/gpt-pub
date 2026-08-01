$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (Test-Path build) { Remove-Item build -Recurse -Force }
New-Item build -ItemType Directory | Out-Null

$testDataRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("MediovaBuildTest-" + [guid]::NewGuid().ToString("N"))
New-Item $testDataRoot -ItemType Directory -Force | Out-Null
$oldLocalAppData = $env:LOCALAPPDATA
$oldAppData = $env:APPDATA
$oldXdgConfigHome = $env:XDG_CONFIG_HOME
try {
    $env:LOCALAPPDATA = $testDataRoot
    $env:APPDATA = $testDataRoot
    $env:XDG_CONFIG_HOME = $testDataRoot
    go test -count=1 ./...
    if ($LASTEXITCODE -ne 0) { throw "go test failed" }
} finally {
    $env:LOCALAPPDATA = $oldLocalAppData
    $env:APPDATA = $oldAppData
    $env:XDG_CONFIG_HOME = $oldXdgConfigHome
    Remove-Item $testDataRoot -Recurse -Force -ErrorAction SilentlyContinue
}
go vet -unsafeptr=false ./...
if ($LASTEXITCODE -ne 0) { throw "go vet failed" }

go build -buildvcs=false -trimpath -ldflags='-H=windowsgui -s -w' -o build/Mediova_v4.0.0_raw.exe ./cmd/mediaworkbench
if ($LASTEXITCODE -ne 0) { throw "go build failed" }
python tools_embed_resources.py assets/v2.8.4_resources.mwrsrc build/Mediova_v4.0.0_raw.exe build/Mediova_v4.0.0.exe --version 4.0.0
if ($LASTEXITCODE -ne 0) { throw "resource embedding failed" }
Remove-Item build/Mediova_v4.0.0_raw.exe -Force
$hash = (Get-FileHash build/Mediova_v4.0.0.exe -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content build/SHA256.txt "$hash  Mediova_v4.0.0.exe" -Encoding Ascii
Write-Host "Built build/Mediova_v4.0.0.exe"
Write-Host "SHA-256: $hash"
