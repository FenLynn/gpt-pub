$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Write-Host 'LaserBench: downloading the Microsoft Edge WebView2 Evergreen Bootstrapper...'
$url = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703'
$temp = Join-Path $env:TEMP ('MicrosoftEdgeWebView2Setup-' + [guid]::NewGuid().ToString('N') + '.exe')
try {
    Invoke-WebRequest -Uri $url -OutFile $temp -UseBasicParsing
    $signature = Get-AuthenticodeSignature $temp
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft') {
        throw 'Downloaded WebView2 bootstrapper does not have a valid Microsoft Authenticode signature.'
    }
    Write-Host 'Installing Microsoft Edge WebView2 Evergreen Runtime...'
    $process = Start-Process -FilePath $temp -ArgumentList '/silent','/install' -Wait -PassThru
    if ($process.ExitCode -notin 0,3010) { throw "The WebView2 installer exited with code $($process.ExitCode)." }
    Write-Host 'LaserBench WebView2 dependency installation completed.'
}
finally {
    Remove-Item $temp -Force -ErrorAction SilentlyContinue
}
