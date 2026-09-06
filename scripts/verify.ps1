#Requires -Version 5.1
# Note: release-gates.md requires PowerShell 7 for production.
<#
    .SYNOPSIS
    Run layered verification for the Coding Agent Workbench.

    .DESCRIPTION
    Executes verification in layers. Currently supports:
      - typecheck: TypeScript Project References build check
      - spike: M0+M1 Implementation Readiness Spike validations
      - integration: M1 回归、事务回滚、真实 Utility Process 与 Electron 冒烟

    .NOTES
    Standard script contract per release-gates.md.
    Does not depend on global Python, Java, or hidden paths.
    Exit code 0 = all selected gates passed, non-0 = at least one failure.
#>

[CmdletBinding()]
param(
    [Parameter()]
    [ValidateSet("typecheck", "spike", "integration", "m2-fault-injection", "all")]
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

# Resolve Node.js path (prefer managed runtime)
$nodeExe = $null
$managedNode = Join-Path $projectRoot 'runtime/node/node.exe'
if (Test-Path $managedNode) {
    $nodeExe = $managedNode
} elseif (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeExe = "node"
} else {
    Write-Host "[verify] Node.js not found. Please install Node.js 22+." -ForegroundColor Red
    exit 1
}
Write-Host "[verify] Node: $nodeExe" -ForegroundColor DarkGray

Push-Location $projectRoot
try {
    # Gate: typecheck
    if ($Gate -contains "typecheck" -or $Gate -contains "all") {
        Write-Host "`n[verify] === Gate: typecheck ===" -ForegroundColor Cyan
        & $nodeExe (Join-Path $projectRoot 'node_modules/typescript/bin/tsc') --build
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[verify] typecheck: PASS" -ForegroundColor Green
        } else {
            Write-Host "[verify] typecheck: FAIL (exit $LASTEXITCODE)" -ForegroundColor Red
            $exitCode = 1
        }
    }

    # Gate: spike
    if ($Gate -contains "spike" -or $Gate -contains "all") {
        Write-Host "`n[verify] === Gate: spike ===" -ForegroundColor Cyan

        $spikeResults = @()
        $evidenceDir = Join-Path $projectRoot "release-evidence"

        # --- T-003: Protocol Handshake & Schema Hash ---
        Write-Host "[verify] T-003: Protocol handshake & schema hash..." -ForegroundColor DarkGray
        $schemaHashFile = Join-Path $evidenceDir "schema-hash.txt"
        $schemaHashExists = Test-Path $schemaHashFile
        $spikeResults += [PSCustomObject]@{
            Ticket = "T-003"
            Name   = "Protocol Handshake & Schema Hash"
            Pass   = $schemaHashExists
            Check  = if ($schemaHashExists) { "schema-hash.txt exists" } else { "schema-hash.txt missing" }
        }

        # --- T-004: Thread Lifecycle ---
        $traceFile = Join-Path $evidenceDir "protocol-trace/thread-lifecycle-trace.jsonl"
        $traceExists = Test-Path $traceFile
        $spikeResults += [PSCustomObject]@{
            Ticket = "T-004"
            Name   = "Thread Lifecycle"
            Pass   = $traceExists
            Check  = if ($traceExists) { "trace exists" } else { "trace missing" }
        }

        # --- T-005: Turn Control ---
        $turnTrace = Join-Path $evidenceDir "protocol-trace/turn-control-trace.jsonl"
        $turnExists = Test-Path $turnTrace
        $spikeResults += [PSCustomObject]@{
            Ticket = "T-005"
            Name   = "Turn Control"
            Pass   = $turnExists
            Check  = if ($turnExists) { "trace exists" } else { "trace missing" }
        }

        # --- T-006: Approval Mechanism ---
        $approvalTrace = Join-Path $evidenceDir "protocol-trace/approval-mechanism-trace.jsonl"
        $approvalExists = Test-Path $approvalTrace
        $spikeResults += [PSCustomObject]@{
            Ticket = "T-006"
            Name   = "Approval Mechanism"
            Pass   = $approvalExists
            Check  = if ($approvalExists) { "trace exists" } else { "trace missing" }
        }

        # --- T-007: Reviewer Subagent ---
        $reviewerTrace = Join-Path $evidenceDir "protocol-trace/reviewer-subagent-trace.jsonl"
        $reviewerExists = Test-Path $reviewerTrace
        $spikeResults += [PSCustomObject]@{
            Ticket = "T-007"
            Name   = "Reviewer Subagent"
            Pass   = $reviewerExists
            Check  = if ($reviewerExists) { "trace exists" } else { "trace missing" }
        }

        # --- T-008: Disconnect No-Replay ---
        $disconnectTrace = Join-Path $evidenceDir "failure-injection/disconnect-no-replay-trace.jsonl"
        $disconnectExists = Test-Path $disconnectTrace
        $spikeResults += [PSCustomObject]@{
            Ticket = "T-008"
            Name   = "Disconnect No-Replay"
            Pass   = $disconnectExists
            Check  = if ($disconnectExists) { "trace exists" } else { "trace missing" }
        }

        # --- T-009: Provider Probe ---
        Write-Host "[verify] T-009: Provider Probe (checking existing report)..." -ForegroundColor DarkGray
        $probeReport = Join-Path $evidenceDir "provider-probe-report.json"
        $probePass = $false
        if (Test-Path $probeReport) {
            $probeData = Get-Content $probeReport -Raw | ConvertFrom-Json
            $probePass = $probeData.overall.pass -eq $true
        }
        $spikeResults += [PSCustomObject]@{
            Ticket = "T-009"
            Name   = "Provider Probe"
            Pass   = $probePass
            Check  = if ($probePass) { "all probes passed" } else { "probe report missing or failed" }
        }

        # --- T-010: Probe Invalidation ---
        Write-Host "[verify] T-010: Probe Invalidation..." -ForegroundColor DarkGray
        $invalidationPass = $false
        if (Test-Path $probeReport) {
            $probeData = Get-Content $probeReport -Raw | ConvertFrom-Json
            if ($probeData.invalidationTests) {
                $invalidationPass = $probeData.invalidationTests.allPassed -eq $true
            }
        }
        $spikeResults += [PSCustomObject]@{
            Ticket = "T-010"
            Name   = "Probe Invalidation"
            Pass   = $invalidationPass
            Check  = if ($invalidationPass) { "all invalidation tests passed" } else { "invalidation tests missing or failed" }
        }

        # --- T-011: Packaged SQLite ---
        Write-Host "[verify] T-011: Packaged SQLite..." -ForegroundColor DarkGray
        $sqliteReport = Join-Path $evidenceDir "sqlite-packaged-test.json"
        $sqlitePass = $false
        if (Test-Path $sqliteReport) {
            $sqliteData = Get-Content $sqliteReport -Raw | ConvertFrom-Json
            $sqlitePass = $sqliteData.overall.pass -eq $true
        }
        $spikeResults += [PSCustomObject]@{
            Ticket = "T-011"
            Name   = "Packaged SQLite"
            Pass   = $sqlitePass
            Check  = if ($sqlitePass) { "all SQLite tests passed" } else { "SQLite test missing or failed" }
        }

        # --- T-012: Secret Isolation ---
        Write-Host "[verify] T-012: Secret Isolation..." -ForegroundColor DarkGray
        $secretReport = Join-Path $evidenceDir "secret-isolation-report.json"
        $secretPass = $false
        if (Test-Path $secretReport) {
            $secretData = Get-Content $secretReport -Raw | ConvertFrom-Json
            $secretPass = $secretData.overall.pass -eq $true
        }
        $spikeResults += [PSCustomObject]@{
            Ticket = "T-012"
            Name   = "Secret Isolation"
            Pass   = $secretPass
            Check  = if ($secretPass) { "all isolation checks passed" } else { "isolation checks missing or failed" }
        }

        # --- T-013: Minimal Build ---
        Write-Host "[verify] T-013: Minimal Build..." -ForegroundColor DarkGray
        $buildManifest = Join-Path $evidenceDir "build-manifest.json"
        $buildPass = $false
        if (Test-Path $buildManifest) {
            $buildData = Get-Content $buildManifest -Raw | ConvertFrom-Json
            $nsisOk = ($buildData.artifacts | Where-Object { $_.type -eq "nsis-installer" }).exists -eq $true
            $portableOk = ($buildData.artifacts | Where-Object { $_.type -eq "portable-exe" }).exists -eq $true
            $buildPass = $nsisOk -and $portableOk
        }
        $spikeResults += [PSCustomObject]@{
            Ticket = "T-013"
            Name   = "Minimal Build (NSIS + Portable)"
            Pass   = $buildPass
            Check  = if ($buildPass) { "both artifacts exist" } else { "artifacts missing" }
        }

        # --- T-014: Data Isolation ---
        Write-Host "[verify] T-014: Data Isolation..." -ForegroundColor DarkGray
        $dataIsolationPass = $false
        if (Test-Path $buildManifest) {
            $buildData = Get-Content $buildManifest -Raw | ConvertFrom-Json
            if ($buildData.dataIsolationTest) {
                $dataIsolationPass = $buildData.dataIsolationTest.allPassed -eq $true
            }
        }
        $spikeResults += [PSCustomObject]@{
            Ticket = "T-014"
            Name   = "Data Isolation"
            Pass   = $dataIsolationPass
            Check  = if ($dataIsolationPass) { "all isolation checks passed" } else { "isolation checks missing or failed" }
        }

        # --- M1: Single Task Vertical Slice E2E ---
        Write-Host "[verify] M1: Single Task Vertical Slice E2E..." -ForegroundColor DarkGray
        $m1Report = Join-Path $evidenceDir "m1-slice-e2e.json"
        $m1E2ePass = $false
        if (Test-Path $m1Report) {
            $m1Data = Get-Content $m1Report -Raw | ConvertFrom-Json
            $m1E2ePass = $m1Data.overall.pass -eq $true
        }
        $spikeResults += [PSCustomObject]@{
            Ticket = "M1"
            Name   = "Single Task Vertical Slice E2E"
            Pass   = $m1E2ePass
            Check  = if ($m1E2ePass) { "all 18 slice checks passed" } else { "slice E2E missing or failed (run .scratch/m1-e2e/verify.mjs)" }
        }

        # --- Print results ---
        Write-Host ""
        $spikeResults | ForEach-Object {
            $color = if ($_.Pass) { "Green" } else { "Red" }
            $status = if ($_.Pass) { "PASS" } else { "FAIL" }
            Write-Host "[verify] $($_.Ticket) $($_.Name): $status" -ForegroundColor $color
            if (-not $_.Pass) {
                Write-Host "         → $($_.Check)" -ForegroundColor DarkRed
            }
        }

        # --- Summary ---
        $passed = ($spikeResults | Where-Object { $_.Pass }).Count
        $failed = ($spikeResults | Where-Object { -not $_.Pass }).Count
        Write-Host "`n[verify] Spike: $passed passed, $failed failed" -ForegroundColor Cyan

        if ($failed -gt 0) {
            $exitCode = 1
        }

        # --- Evidence directory check ---
        $expectedFiles = @(
            "schema-hash.txt",
            "provider-probe-report.json",
            "sqlite-packaged-test.json",
            "secret-isolation-report.json",
            "build-manifest.json",
            "m1-slice-e2e.json"
        )
        $missingFiles = @()
        foreach ($f in $expectedFiles) {
            $fullPath = Join-Path $evidenceDir $f
            if (-not (Test-Path $fullPath)) {
                $missingFiles += $f
            }
        }
        if ($missingFiles.Count -gt 0) {
            Write-Host "[verify] Missing evidence files: $($missingFiles -join ', ')" -ForegroundColor Red
            $exitCode = 1
        } else {
            Write-Host "[verify] All expected evidence files present." -ForegroundColor Green
        }
    }

    # 真实集成验证先构建，再执行原有回归、跨进程切片和 Electron 冒烟。
    if ($Gate -contains 'integration' -or $Gate -contains 'all') {
        & $nodeExe (Join-Path $projectRoot 'node_modules/typescript/bin/tsc') --build
        if ($LASTEXITCODE -eq 0) {
            & $nodeExe (Join-Path $projectRoot 'node_modules/electron-vite/bin/electron-vite.js') build
        }
        if ($LASTEXITCODE -ne 0) {
            $exitCode = 1
        } else {
            & $nodeExe (Join-Path $projectRoot 'scripts/test-m1.mjs')
            if ($LASTEXITCODE -ne 0) { $exitCode = 1 }
            & $nodeExe (Join-Path $projectRoot 'tests/integration/interrupt-transaction.mjs')
            if ($LASTEXITCODE -ne 0) { $exitCode = 1 }
            & $nodeExe (Join-Path $projectRoot 'scripts/test-agent-manager.mjs')
            if ($LASTEXITCODE -ne 0) { $exitCode = 1 }
        }
    }

    # M2 故障矩阵为严格门禁；部分通过与缺少真实 Provider 均不得返回成功。
    if ($Gate -contains 'm2-fault-injection' -or $Gate -contains 'all') {
        & $nodeExe (Join-Path $projectRoot 'node_modules/typescript/bin/tsc') --build
        if ($LASTEXITCODE -eq 0) {
            & $nodeExe (Join-Path $projectRoot 'node_modules/electron-vite/bin/electron-vite.js') build
        }
        if ($LASTEXITCODE -ne 0) {
            $exitCode = 1
        } else {
            & $nodeExe (Join-Path $projectRoot 'scripts/test-m2-fault-injection.mjs')
            if ($LASTEXITCODE -ne 0) { $exitCode = 1 }
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
