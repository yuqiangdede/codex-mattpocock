#Requires -Version 5.1
# Note: release-gates.md requires PowerShell 7 for production.
<#
    .SYNOPSIS
    Run layered verification for the Coding Agent Workbench.

    .DESCRIPTION
    Executes verification in layers. Currently supports:
      - typecheck: TypeScript Project References build check

    Future gates (spike, integration, e2e) will be added as milestones
    are reached.

    .NOTES
    Standard script contract per release-gates.md.
    Does not depend on global Python, Java, or hidden paths.
    Exit code 0 = all selected gates passed, non-0 = at least one failure.
#>

[CmdletBinding()]
param(
    [Parameter()]
    [ValidateSet("typecheck", "all")]
    [string[]]$Gate = @("typecheck")
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")
$projectRoot = Get-ProjectRoot
$exitCode = 0

Write-Host "[verify] Project root: $projectRoot" -ForegroundColor Cyan
Write-Host "[verify] Gates: $($Gate -join ', ')" -ForegroundColor Cyan

# Ensure dependencies
if (-not (Ensure-Dependencies $projectRoot)) {
    exit 1
}

Push-Location $projectRoot
try {
    # Gate: typecheck
    if ($Gate -contains "typecheck" -or $Gate -contains "all") {
        Write-Host "`n[verify] === Gate: typecheck ===" -ForegroundColor Cyan
        pnpm tsc --build
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[verify] typecheck: PASS" -ForegroundColor Green
        } else {
            Write-Host "[verify] typecheck: FAIL (exit $LASTEXITCODE)" -ForegroundColor Red
            $exitCode = 1
        }
    }

    # Summary
    Write-Host "`n[verify] === Summary ===" -ForegroundColor Cyan
    if ($exitCode -eq 0) {
        Write-Host "[verify] All selected gates passed." -ForegroundColor Green
    } else {
        Write-Host "[verify] One or more gates failed." -ForegroundColor Red
    }
} finally {
    Pop-Location
}

exit $exitCode
