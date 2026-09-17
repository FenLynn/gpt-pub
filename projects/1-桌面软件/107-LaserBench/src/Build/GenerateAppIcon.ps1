param([Parameter(Mandatory=$true)][string]$OutputPath)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$size = 64
$bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
try {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $ink = [System.Drawing.Color]::FromArgb(38, 83, 119)
    $accent = [System.Drawing.Color]::FromArgb(46, 153, 225)
    $pen = New-Object System.Drawing.Pen($ink, 4.5)
    $accentPen = New-Object System.Drawing.Pen($accent, 4.0)
    try {
        $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

        # LaserBench mark: compact optical beam ring plus live trace.
        $g.DrawEllipse($pen, 12, 12, 40, 40)
        $g.DrawEllipse($accentPen, 22, 22, 20, 20)
        $pts = @(
            (New-Object System.Drawing.PointF(7, 38)),
            (New-Object System.Drawing.PointF(17, 38)),
            (New-Object System.Drawing.PointF(24, 29)),
            (New-Object System.Drawing.PointF(31, 45)),
            (New-Object System.Drawing.PointF(39, 33)),
            (New-Object System.Drawing.PointF(47, 38)),
            (New-Object System.Drawing.PointF(57, 38))
        )
        $g.DrawLines($accentPen, $pts)
    }
    finally {
        $pen.Dispose()
        $accentPen.Dispose()
    }

    $dir = Split-Path -Parent $OutputPath
    if ($dir) { [System.IO.Directory]::CreateDirectory($dir) | Out-Null }
    $hIcon = $bmp.GetHicon()
    try {
        $icon = [System.Drawing.Icon]::FromHandle($hIcon)
        $stream = [System.IO.File]::Create($OutputPath)
        try { $icon.Save($stream) } finally { $stream.Dispose() }
    }
    finally {
        Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LaserBenchNativeIcon {
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern bool DestroyIcon(IntPtr handle);
}
'@ -ErrorAction SilentlyContinue
        [LaserBenchNativeIcon]::DestroyIcon($hIcon) | Out-Null
    }
}
finally {
    $g.Dispose()
    $bmp.Dispose()
}
