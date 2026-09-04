#Requires -Version 5.1
# Note: release-gates.md requires PowerShell 7 for production.
<#
    .SYNOPSIS
    Start the development Electron application.

    .DESCRIPTION
    Launches electron-vite dev server and starts the Electron app in
    development mode. Does not depend on global Python, Java, or hidden paths.

    .NOTES
    Standard script contract per release-gates.md.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "[start] Project root: $projectRoot" -ForegroundColor Cyan

# Verify dependencies are installed
$nodeModules = Join-Path $projectRoot "node_modules"
if (-not (Test-Path $nodeModules)) {
    Write-Host "[start] node_modules not found, running init..." -ForegroundColor Yellow
    & (Join-Path $PSScriptRoot "init.ps1")
    if ($LASTEXITCODE -ne 0) {
        Write-Error "init failed, cannot start."
        exit 1
    }
}

# Start electron-vite dev
Write-Host "[start] Launching electron-vite dev..." -ForegroundColor Cyan
Push-Location $projectRoot
try {
    pnpm dev
} finally {
    Pop-Location
}
