$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $PSScriptRoot
$batPath = Join-Path $scriptDir "start-backend-and-ngrok.bat"
if (-not (Test-Path $batPath)) { Write-Error "Chyba: $batPath"; exit 1 }
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Nike Backend + ngrok.lnk"
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($shortcutPath)
$sc.TargetPath = $batPath
$sc.WorkingDirectory = $scriptDir
$sc.Description = "Spusti backend a ngrok (dve PowerShell okna)"
$iconPath = Join-Path $scriptDir "desktop\assets\app-icon.ico"
if (Test-Path $iconPath) { $sc.IconLocation = $iconPath }
$sc.Save()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($ws) | Out-Null
Write-Host "Na ploche je zástupca: Nike Backend + ngrok"
