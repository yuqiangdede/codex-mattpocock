#Requires -Version 5.1
# Note: release-gates.md requires PowerShell 7 for production.
<#
    .SYNOPSIS
    Initialize project dependencies and development environment.

    .DESCRIPTION
    Installs pnpm workspace dependencies, ensures runtime directory exists,
    and prepares the development environment. Does not download Codex Runtime
    (that is T-002's responsibility). Does not depend on global Python, Java,
    or hidden paths.

    .NOTES
    Standard script contract per release-gates.md.
    Must be runnable on a fresh clone with only Node.js and pnpm installed.
#>

[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")
$projectRoot = Get-ProjectRoot

Write-Host "[init] Project root: $projectRoot"

# Verify Node.js is available
$nodeVersion = & node --version 2>$null
if ($LASTEXITCODE -ne 0 -or -not $nodeVersion) {
    Write-Error "Node.js is required but not found in PATH. Please install Node.js >= 22.0.0."
    exit 1
}
Write-Host "[init] Node.js: $nodeVersion"

# Verify pnpm is available
$pnpmVersion = & pnpm --version 2>$null
if ($LASTEXITCODE -ne 0 -or -not $pnpmVersion) {
    Write-Host "[init] pnpm not found, installing via npm..."
    & npm install -g pnpm
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to install pnpm."
        exit 1
    }
    $pnpmVersion = & pnpm --version
}
Write-Host "[init] pnpm: $pnpmVersion"

# Install workspace dependencies
Write-Host "[init] Installing workspace dependencies..."
Push-Location $projectRoot
try {
    if ($Force) {
        & pnpm install --frozen-lockfile=false
    } else {
        & pnpm install
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Error "pnpm install failed with exit code $LASTEXITCODE"
        exit 1
    }
    Write-Host "[init] Dependencies installed successfully."
} finally {
    Pop-Location
}

# Ensure runtime directory exists (Codex Binary download target)
$runtimeDir = Join-Path $projectRoot "runtime"
if (-not (Test-Path $runtimeDir)) {
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    Write-Host "[init] Created runtime/ directory."
}

# Ensure data directory exists
$dataDir = Join-Path $projectRoot "data"
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    Write-Host "[init] Created data/ directory."
}

# Ensure logs directory exists
$logsDir = Join-Path $projectRoot "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
    Write-Host "[init] Created logs/ directory."
}

Write-Host "[init] Done."
exit 0
