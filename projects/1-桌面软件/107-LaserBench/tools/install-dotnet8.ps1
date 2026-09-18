$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Write-Host 'LaserBench: resolving the latest .NET 8 Desktop Runtime x64 installer from Microsoft...'
$metadataUrl = 'https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/8.0/releases.json'
$metadata = Invoke-RestMethod -Uri $metadataUrl -UseBasicParsing
$release = $metadata.releases | Select-Object -First 1
if (-not $release -or -not $release.windowsdesktop) {
    throw 'Microsoft .NET 8 release metadata did not contain a Windows Desktop Runtime entry.'
}

$file = $release.windowsdesktop.files |
    Where-Object { $_.rid -eq 'win-x64' -and $_.url -match '\.exe$' } |
    Select-Object -First 1
if (-not $file) {
    throw 'Could not resolve the Windows x64 Desktop Runtime installer from Microsoft metadata.'
}

$temp = Join-Path $env:TEMP ('windowsdesktop-runtime-8-' + [guid]::NewGuid().ToString('N') + '.exe')
try {
    Write-Host ('Downloading ' + $file.url)
    Invoke-WebRequest -Uri $file.url -OutFile $temp -UseBasicParsing

    if ($file.hash) {
        $actual = (Get-FileHash $temp -Algorithm SHA512).Hash.ToLowerInvariant()
        $expected = ([string]$file.hash).ToLowerInvariant()
        if ($actual -ne $expected) {
            throw 'Downloaded .NET Desktop Runtime SHA-512 does not match Microsoft release metadata.'
        }
    }

    $signature = Get-AuthenticodeSignature $temp
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft') {
        throw 'Downloaded .NET Desktop Runtime does not have a valid Microsoft Authenticode signature.'
    }

    Write-Host 'Installing .NET 8 Desktop Runtime...'
    $process = Start-Process -FilePath $temp -ArgumentList '/install','/quiet','/norestart' -Wait -PassThru
    if ($process.ExitCode -notin 0,3010) {
        throw "The .NET installer exited with code $($process.ExitCode)."
    }

    Write-Host 'LaserBench dependency installation completed.'
}
finally {
    Remove-Item $temp -Force -ErrorAction SilentlyContinue
}
