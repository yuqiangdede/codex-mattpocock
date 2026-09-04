#Requires -Version 5.1
# Note: release-gates.md requires PowerShell 7 for production.
<#
    .SYNOPSIS
    Run layered verification for the Coding Agent Workbench.

    .DESCRIPTION
    Executes verification in layers. Currently supports:
      - typecheck: TypeScript Project References build check
      - spike:     M0-M1 Implementation Readiness Spike (T-015)

    Future gates will be added as milestones are reached.

    .NOTES
    Standard script contract per release-gates.md.
    Does not depend on global Python, Java, or hidden paths.
    Exit code 0 = all selected gates passed, non-0 = at least one failure.
#>

[CmdletBinding()]
param(
    [Parameter()]
    [ValidateSet("typecheck", "spike", "all")]
    [string[]]$Gate = @("typecheck"),

    [switch]$KeepFailures
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$exitCode = 0

Write-Host "[verify] Project root: $projectRoot" -ForegroundColor Cyan
Write-Host "[verify] Gates: $($Gate -join ', ')" -ForegroundColor Cyan

# Ensure dependencies
$nodeModules = Join-Path $projectRoot "node_modules"
if (-not (Test-Path $nodeModules)) {
    Write-Host "[verify] node_modules not found, running init..." -ForegroundColor Yellow
    & (Join-Path $PSScriptRoot "init.ps1")
    if ($LASTEXITCODE -ne 0) {
        Write-Error "init failed, cannot verify."
        exit 1
    }
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

    # Gate: spike (T-015 integration — placeholder until T-015 is implemented)
    if ($Gate -contains "spike" -or $Gate -contains "all") {
        Write-Host "`n[verify] === Gate: spike ===" -ForegroundColor Cyan
        $spikeScript = Join-Path $projectRoot "scripts/spike/run-spike.ps1"
        if (Test-Path $spikeScript) {
            & $spikeScript
            if ($LASTEXITCODE -eq 0) {
                Write-Host "[verify] spike: PASS" -ForegroundColor Green
            } else {
                Write-Host "[verify] spike: FAIL (exit $LASTEXITCODE)" -ForegroundColor Red
                $exitCode = 1
            }
        } else {
            Write-Host "[verify] spike: SKIPPED (T-015 not yet implemented)" -ForegroundColor Yellow
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
