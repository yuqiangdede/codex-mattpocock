<#
    .SYNOPSIS
    Shared helpers for standard scripts.

    .DESCRIPTION
    Common functions used by init.ps1, start.ps1, and verify.ps1
    to avoid duplicated logic across scripts.
#>

# Returns the project root directory (parent of the scripts/ folder).
function Get-ProjectRoot {
    return Split-Path -Parent $PSScriptRoot
}

# Ensures node_modules exists. If missing, runs init.ps1.
# Returns $true if dependencies are ready, $false on failure.
function Ensure-Dependencies {
    param([string]$ProjectRoot)

    $nodeModules = Join-Path $ProjectRoot "node_modules"
    if (-not (Test-Path $nodeModules)) {
        Write-Host "[common] node_modules not found, running init..." -ForegroundColor Yellow
        & (Join-Path $PSScriptRoot "init.ps1")
        if ($LASTEXITCODE -ne 0) {
            Write-Error "init failed."
            return $false
        }
    }
    return $true
}
