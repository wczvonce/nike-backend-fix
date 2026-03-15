param(
  [string]$OutputDir = "desktop/assets"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root $OutputDir
New-Item -ItemType Directory -Force -Path $target | Out-Null

Add-Type -AssemblyName System.Drawing

$bmp = New-Object System.Drawing.Bitmap 256, 256
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(255, 18, 24, 38))

$bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 28, 36, 58))
$g.FillEllipse($bgBrush, 22, 22, 212, 212)

$linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 76, 175, 80), 12)
$g.DrawLines($linePen, @(
  [System.Drawing.Point]::new(52, 176),
  [System.Drawing.Point]::new(96, 138),
  [System.Drawing.Point]::new(138, 148),
  [System.Drawing.Point]::new(196, 92)
))

$upBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 76, 175, 80))
$downBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 152, 0))
$g.FillPolygon($upBrush, @(
  [System.Drawing.Point]::new(178, 72),
  [System.Drawing.Point]::new(214, 92),
  [System.Drawing.Point]::new(196, 44)
))
$g.FillPolygon($downBrush, @(
  [System.Drawing.Point]::new(60, 70),
  [System.Drawing.Point]::new(94, 70),
  [System.Drawing.Point]::new(77, 102)
))

$badgeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 33, 150, 243))
$g.FillEllipse($badgeBrush, 162, 162, 60, 60)

$checkPen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 8)
$g.DrawLines($checkPen, @(
  [System.Drawing.Point]::new(176, 194),
  [System.Drawing.Point]::new(188, 206),
  [System.Drawing.Point]::new(208, 182)
))

$pngPath = Join-Path $target "app-icon.png"
$icoPath = Join-Path $target "app-icon.ico"
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$fs = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
$icon.Save($fs)
$fs.Close()

$icon.Dispose()
$linePen.Dispose()
$checkPen.Dispose()
$upBrush.Dispose()
$downBrush.Dispose()
$bgBrush.Dispose()
$badgeBrush.Dispose()
$g.Dispose()
$bmp.Dispose()

Write-Output "Created icon files:"
Write-Output $pngPath
Write-Output $icoPath
