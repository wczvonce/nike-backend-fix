# Optional helper to run the backend on Windows.
# Usage: .\start.ps1   (or: powershell -ExecutionPolicy Bypass -File .\start.ps1)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
Set-Location $projectRoot

Write-Host "Checking Node.js..." -ForegroundColor Cyan
$nodeVersion = node -v 2>$null
if (-not $nodeVersion) {
    Write-Host "Node.js not found. Install Node.js 18+ from https://nodejs.org" -ForegroundColor Red
    exit 1
}
Write-Host "  $nodeVersion" -ForegroundColor Green

if (-not (Test-Path "node_modules")) {
    Write-Host "Running npm install..." -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Run once: npm run install:browsers" -ForegroundColor Yellow
}

if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "Created .env from .env.example" -ForegroundColor Yellow
    }
}

$port = 3001
if (Test-Path ".env") {
    $portLine = Get-Content ".env" | Where-Object { $_ -match "^PORT=" } | Select-Object -First 1
    if ($portLine) {
        $portRaw = ($portLine -split "=", 2)[1]
        $parsed = 0
        if ([int]::TryParse($portRaw, [ref]$parsed)) { $port = $parsed }
    }
}

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    Write-Host "Port $port is in use (PID $($listener.OwningProcess)); stopping old process..." -ForegroundColor Yellow
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

Write-Host "Starting server..." -ForegroundColor Cyan
Write-Host "  Health: http://localhost:3001/health" -ForegroundColor Gray
npm start
