<#
.SYNOPSIS
    Automated script to build and run HELIX agent tests in Docker Linux.
#>
param (
    [switch]$Rebuild
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

Write-Host "🐳 HELIX - Linux Container Test Suite" -ForegroundColor Cyan

# 1. Build image if requested or missing
$ImageExists = docker images -q helix-test-linux
if ($Rebuild -or -not $ImageExists) {
    Write-Host "📦 Building helix-test-linux Docker image..." -ForegroundColor Yellow
    docker build -f "$Root/Dockerfile.test-linux" -t helix-test-linux "$Root"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Docker build failed"
        exit 1
    }
}

# 2. Run the test suite
Write-Host "🚀 Running full test suite inside Linux container..." -ForegroundColor Green
docker run --rm `
    -v "${Root}/services/agent:/app/services/agent" `
    -v "${Root}/config:/app/config" `
    -e DISPLAY=:99 `
    helix-test-linux `
    sh -c "Xvfb :99 -screen 0 1024x768x24 -ac & sleep 1 && python -m pytest services/agent/tests/ -v --tb=short"

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ All tests passed successfully in Linux Docker!" -ForegroundColor Green
} else {
    Write-Host "❌ Some tests failed in Linux Docker" -ForegroundColor Red
}
exit $LASTEXITCODE
