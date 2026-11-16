# SPDX-FileCopyrightText: 2026 Edward Nguyen
# SPDX-License-Identifier: Apache-2.0
# Builds and verifies the Creo MCP server.
#
# Usage:
#   .\scripts\install.ps1
#   .\scripts\install.ps1 -SkipNative -SkipDoctor

[CmdletBinding()]
param(
    [switch]$SkipNative,
    [switch]$SkipDoctor
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
    Write-Host "== npm install ==" -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }

    if (-not $SkipNative) {
        Write-Host "== build native bridge ==" -ForegroundColor Cyan
        & (Join-Path $PSScriptRoot 'build-native.ps1')
    }

    Write-Host "== build MCP server ==" -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Server build failed' }

    if (-not $SkipDoctor) {
        Write-Host "== doctor (mock bridge) ==" -ForegroundColor Cyan
        node packages/server/dist/cli/doctor.js --mock
    }

    Write-Host ""
    Write-Host "Setup complete." -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Start Creo Parametric."
    Write-Host "  2. Verify against the live session:"
    Write-Host "       node packages/server/dist/cli/doctor.js"
    Write-Host "       node scripts/integration-smoke.mjs"
    Write-Host "  3. Wire a client using a template from config/clients/:"
    Write-Host "       claude_desktop_config.json | codex.toml | opencode.json | cursor.mcp.json"
    Write-Host "     Replace <REPO_ROOT> with: $repoRoot"
}
finally {
    Pop-Location
}
