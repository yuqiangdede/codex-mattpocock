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

. (Join-Path $PSScriptRoot "common.ps1")
$projectRoot = Get-ProjectRoot

Write-Host "[start] Project root: $projectRoot" -ForegroundColor Cyan

# Ensure dependencies are installed
if (-not (Ensure-Dependencies $projectRoot)) {
    exit 1
}

# Start electron-vite dev
Write-Host "[start] Launching electron-vite dev..." -ForegroundColor Cyan
Push-Location $projectRoot
try {
    pnpm dev
} finally {
    Pop-Location
}
