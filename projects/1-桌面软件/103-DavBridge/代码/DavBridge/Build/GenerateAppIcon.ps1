param([Parameter(Mandatory=$true)][string]$OutputPath)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$size = 64
$bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
try {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # DavBridge mark: a clean bridge arch feeding a rightward migration arrow.
    $bridge = [System.Drawing.Color]::FromArgb(38, 83, 119)
    $flow = [System.Drawing.Color]::FromArgb(92, 183, 231)
    $bridgePen = New-Object System.Drawing.Pen($bridge, 6.0)
    $flowPen = New-Object System.Drawing.Pen($flow, 5.0)
    try {
        $bridgePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $bridgePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $bridgePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
        $flowPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $flowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $flowPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

        # Two supports and a restrained arch, intentionally bold enough for 16 px tray use.
        $g.DrawLine($bridgePen, 13, 47, 13, 34)
        $g.DrawBezier($bridgePen, 13, 35, 19, 15, 37, 15, 43, 34)
        $g.DrawLine($bridgePen, 43, 34, 43, 39)
        $g.DrawLine($bridgePen, 10, 49, 46, 49)

        # The migration path begins inside the bridge and ends in a sharp, balanced arrowhead.
        $g.DrawLine($flowPen, 25, 33, 52, 33)
        $g.DrawLine($flowPen, 45, 25, 54, 33)
        $g.DrawLine($flowPen, 45, 41, 54, 33)
    }
    finally {
        $bridgePen.Dispose()
        $flowPen.Dispose()
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
public static class DavBridgeNativeIcon {
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern bool DestroyIcon(IntPtr handle);
}
'@ -ErrorAction SilentlyContinue
        [DavBridgeNativeIcon]::DestroyIcon($hIcon) | Out-Null
    }
}
finally {
    $g.Dispose()
    $bmp.Dispose()
}
