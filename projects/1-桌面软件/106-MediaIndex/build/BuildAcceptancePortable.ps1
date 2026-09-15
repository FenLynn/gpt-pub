param(
    [string]$Configuration = "Release"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$srcRoot = Join-Path $projectRoot "src\MediaIndex.Acceptance"
$experimentsRoot = Join-Path $projectRoot "experiments"
$buildRoot = Join-Path $projectRoot ".build\acceptance"
$distRoot = Join-Path $projectRoot "dist"
$version = "0.0.2"
$packageName = "MediaIndex-Acceptance-v$version-win-x64"
$packageRoot = Join-Path $distRoot $packageName
$runtimeRoot = Join-Path $packageRoot "Runtime"

Write-Host ""
Write-Host "============================================================"
Write-Host " MediaIndex Acceptance portable build"
Write-Host "============================================================"
Write-Host ""

New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
New-Item -ItemType Directory -Force -Path $distRoot | Out-Null

function Resolve-DotNet {
    $cmd = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    $localDotnet = Join-Path $buildRoot "dotnet\dotnet.exe"
    if (Test-Path $localDotnet) {
        return $localDotnet
    }

    Write-Host "dotnet SDK was not found. Installing a private .NET 8 SDK for this build..."
    $installer = Join-Path $buildRoot "dotnet-install.ps1"
    Invoke-WebRequest -UseBasicParsing -Uri "https://dot.net/v1/dotnet-install.ps1" -OutFile $installer

    $installDir = Join-Path $buildRoot "dotnet"
    & powershell -NoProfile -ExecutionPolicy Bypass -File $installer -Channel "8.0" -InstallDir $installDir -NoPath

    if (-not (Test-Path $localDotnet)) {
        throw "Private .NET SDK installation failed."
    }

    return $localDotnet
}

function Resolve-Python {
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) {
        return @($python.Source)
    }

    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) {
        return @($py.Source, "-3")
    }

    throw "Python 3 was not found. Python is needed only while building the portable package."
}

function Invoke-PythonCommand {
    param(
        [Parameter(Mandatory=$true)]
        [string[]]$PythonCommand,
        [Parameter(Mandatory=$true)]
        [string[]]$Arguments
    )

    $exe = $PythonCommand[0]
    $prefix = @()
    if ($PythonCommand.Length -gt 1) {
        $prefix = $PythonCommand[1..($PythonCommand.Length - 1)]
    }

    & $exe @prefix @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Python command failed with exit code $LASTEXITCODE"
    }
}

$dotnet = Resolve-DotNet
$pythonCommand = Resolve-Python

Write-Host "Using dotnet: $dotnet"
Write-Host "Using python: $($pythonCommand -join ' ')"

$venvRoot = Join-Path $buildRoot "pyvenv"
$venvPython = Join-Path $venvRoot "Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Host "Creating private Python build environment..."
    Invoke-PythonCommand -PythonCommand $pythonCommand -Arguments @("-m", "venv", $venvRoot)
}

Write-Host "Installing worker build dependencies..."
& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed." }

& $venvPython -m pip install "pyinstaller>=6.10,<7" "opencv-python>=4.10,<5" "numpy>=2.0,<3" "pillow>=10,<13" "pillow-heif>=0.18,<2"
if ($LASTEXITCODE -ne 0) { throw "Python dependency installation failed." }

$workerDist = Join-Path $buildRoot "worker-dist"
$workerWork = Join-Path $buildRoot "worker-work"
$workerSpec = Join-Path $buildRoot "worker-spec"

Remove-Item -Recurse -Force $workerDist -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $workerWork -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $workerSpec -ErrorAction SilentlyContinue

Write-Host "Building private acceptance worker..."
Push-Location $experimentsRoot
try {
    & $venvPython -m PyInstaller --noconfirm --clean --onefile --console --name "MediaIndex.Acceptance.Worker" --distpath $workerDist --workpath $workerWork --specpath $workerSpec --collect-all pillow_heif "acceptance_worker.py"
    if ($LASTEXITCODE -ne 0) {
        throw "Worker build failed."
    }
}
finally {
    Pop-Location
}

$iconPath = Join-Path $srcRoot "MediaIndex.Acceptance.ico"
Write-Host "Generating application icon..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "GenerateAcceptanceIcon.ps1") -OutputPath $iconPath

$hostPublish = Join-Path $buildRoot "host-publish"
Remove-Item -Recurse -Force $hostPublish -ErrorAction SilentlyContinue

Write-Host "Building self-contained Windows host..."
& $dotnet publish (Join-Path $srcRoot "MediaIndex.Acceptance.csproj") -c $Configuration -r win-x64 --self-contained true -o $hostPublish /p:PublishSingleFile=true /p:IncludeNativeLibrariesForSelfExtract=true
if ($LASTEXITCODE -ne 0) {
    throw "Host build failed."
}

Remove-Item -Recurse -Force $packageRoot -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

Copy-Item (Join-Path $hostPublish "MediaIndex.Acceptance.exe") (Join-Path $packageRoot "MediaIndex Acceptance.exe") -Force
Copy-Item (Join-Path $workerDist "MediaIndex.Acceptance.Worker.exe") $runtimeRoot -Force

$readmeLines = @(
    "MediaIndex Acceptance v$version",
    "",
    "使用：",
    "1. 双击 MediaIndex Acceptance.exe",
    "2. 选择图片库存目录和视频库存目录",
    "3. 添加几个真实 Query",
    "4. 双击 Query 行设置真实源，完全无关的样本点“设为无对应”",
    "5. 点击“开始真实域验收”",
    "6. 需要分享结果时，点击“导出匿名结果”",
    "",
    "私人媒体不会被复制到发布目录。",
    "程序状态与临时 manifest 位于：",
    "%LOCALAPPDATA%\FenLynn\MediaIndex\Acceptance",
    "",
    "本工具是 P106 Phase 0 验收工具，不执行删除、移动或重命名。"
)
Set-Content -Path (Join-Path $packageRoot "README.txt") -Value $readmeLines -Encoding UTF8

$zipPath = Join-Path $distRoot "$packageName.zip"
Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $packageRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal

Remove-Item -Force $iconPath -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Build completed."
Write-Host "Portable folder:"
Write-Host "  $packageRoot"
Write-Host "ZIP:"
Write-Host "  $zipPath"
Write-Host ""
