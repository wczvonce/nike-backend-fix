# Vytvori na ploche zastupcu, ktory spusta desktop aplikaciu Z PROJEKTU (aktualny kod).
# Ciel: c:\nike-backend-fix\START_DESKTOP_APP.bat
# Working directory: c:\nike-backend-fix  -> backend bezi z src/server.js = vsetky opravy platia.
$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $PSScriptRoot
$batPath = Join-Path $scriptDir "START_DESKTOP_APP.bat"
if (-not (Test-Path $batPath)) {
  Write-Error "Chyba: nenajdeny $batPath"
  exit 1
}
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Nike Tipsport Comparator.lnk"
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($shortcutPath)
$sc.TargetPath = $batPath
$sc.WorkingDirectory = $scriptDir
$sc.Description = "Spusti Nike vs Tipsport (desktop okno, aktualny kod z projektu)"
$iconPath = Join-Path $scriptDir "desktop\assets\app-icon.ico"
if (Test-Path $iconPath) { $sc.IconLocation = $iconPath }
$sc.Save()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($ws) | Out-Null
Write-Host "Hotovo. Na ploche je zástupca: Nike Tipsport Comparator"
Write-Host "Ciel: $batPath"
Write-Host "Pracovny priečinok: $scriptDir"
