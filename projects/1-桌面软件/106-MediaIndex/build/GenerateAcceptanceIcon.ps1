param(
    [Parameter(Mandatory=$true)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$size = 64
$bitmap = New-Object System.Drawing.Bitmap $size, $size
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

$background = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(61,120,220))
$graphics.FillRectangle($background, 6, 6, 52, 52)

$white = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 4
$white.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$white.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

$graphics.DrawRectangle($white, 17, 18, 25, 20)
$graphics.DrawEllipse($white, 31, 31, 14, 14)
$graphics.DrawLine($white, 42, 42, 51, 51)

$graphics.Dispose()
$background.Dispose()
$white.Dispose()

$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$stream = [System.IO.File]::Create($OutputPath)
try {
    $icon.Save($stream)
}
finally {
    $stream.Dispose()
    $icon.Dispose()
    $bitmap.Dispose()
}
