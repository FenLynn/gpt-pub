$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDll = Join-Path $root 'LocalSub.dll'
$runtimeDir = Join-Path $root 'runtime'
$localDotnet = Join-Path $runtimeDir 'dotnet.exe'

function Test-DesktopRuntime([string]$dotnet) {
    if (-not (Test-Path $dotnet)) { return $false }
    try {
        $runtimes = & $dotnet --list-runtimes 2>$null
        return [bool]($runtimes | Select-String '^Microsoft\.WindowsDesktop\.App 10\.0\.')
    } catch { return $false }
}

function Start-LocalSub([string]$dotnet) {
    & $dotnet $appDll
    exit $LASTEXITCODE
}

if (Test-DesktopRuntime $localDotnet) {
    Start-LocalSub $localDotnet
}

$candidates = @(
    (Join-Path $env:ProgramFiles 'dotnet\dotnet.exe')
)
if (${env:ProgramFiles(x86)}) {
    $candidates += (Join-Path ${env:ProgramFiles(x86)} 'dotnet\dotnet.exe')
}

foreach ($candidate in $candidates | Select-Object -Unique) {
    if (Test-DesktopRuntime $candidate) {
        Start-LocalSub $candidate
    }
}

Write-Host 'LocalSub needs Microsoft .NET 10 Desktop Runtime.' -ForegroundColor Yellow
Write-Host "It is not installed globally. LocalSub can download it only into: $runtimeDir"
$answer = Read-Host 'Download local runtime now? [Y/N]'
if ($answer -notmatch '^[Yy]') { exit 2 }

New-Item -ItemType Directory -Force $runtimeDir | Out-Null
$installer = Join-Path $runtimeDir 'dotnet-install.ps1'
Write-Host 'Downloading official Microsoft runtime installer...'
Invoke-WebRequest 'https://dot.net/v1/dotnet-install.ps1' -UseBasicParsing -OutFile $installer
& $installer -Runtime windowsdesktop -Channel '10.0' -Quality 'GA' -InstallDir $runtimeDir -NoPath
if ($LASTEXITCODE -ne 0) { throw 'Local .NET runtime download failed.' }

if (-not (Test-DesktopRuntime $localDotnet)) {
    throw 'Runtime files were downloaded but Microsoft.WindowsDesktop.App 10.0 was not detected.'
}

Remove-Item $installer -Force -ErrorAction SilentlyContinue
Start-LocalSub $localDotnet
