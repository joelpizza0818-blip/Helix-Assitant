[CmdletBinding()]
param(
    [string]$OutputPath = "",
    [string]$RepositoryRoot = "",
    [string]$SourceRevision = "",
    [string[]]$SourceOverrides = @(),
    [switch]$CleanSourceSnapshot,
    [string]$InstallerPath = "",
    [string[]]$MeasurePath = @(
        "apps/desktop/agent-runtime",
        "apps/desktop/release/win-unpacked",
        "apps/desktop/dist",
        "apps/desktop/dist-electron"
    )
)

$ErrorActionPreference = "Stop"
$repoRoot = if ($RepositoryRoot) {
    (Resolve-Path -LiteralPath $RepositoryRoot).Path
} else {
    (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
Set-Location $repoRoot

function Get-DirectoryMeasurement([string]$RelativePath) {
    $fullPath = Join-Path $repoRoot $RelativePath
    if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) {
        return [pscustomobject]@{
            Path = $RelativePath
            Exists = $false
            Files = 0
            Bytes = 0
        }
    }

    $files = @(Get-ChildItem -LiteralPath $fullPath -File -Recurse -Force)
    return [pscustomobject]@{
        Path = $RelativePath
        Exists = $true
        Files = $files.Count
        Bytes = [int64](($files | Measure-Object -Property Length -Sum).Sum)
    }
}

function Get-StringSha256([string]$Value) {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
        return -join ($sha256.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") })
    } finally {
        $sha256.Dispose()
    }
}

function Get-CommandVersion([string]$Command, [string[]]$Arguments) {
    try {
        $value = (& $Command @Arguments 2>$null | Select-Object -First 1)
        return [string]$value
    } catch {
        return "unavailable"
    }
}

$pythonCandidates = @(
    (Join-Path $repoRoot "services/agent/.venv/Scripts/python.exe"),
    (Join-Path $repoRoot ".venv/Scripts/python.exe")
)
$buildPython = $pythonCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $buildPython) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCommand) { $buildPython = $pythonCommand.Source }
}

if ($CleanSourceSnapshot) {
    if (-not $SourceRevision) {
        throw "SourceRevision is required when measuring a clean source snapshot."
    }
    $status = @()
    $revision = $SourceRevision
    $sourceType = if ($SourceOverrides.Count -gt 0) { "git-archive-with-overrides" } else { "git-archive" }
    $workingTreeClean = ($SourceOverrides.Count -eq 0)
} else {
    $status = @(git -C $repoRoot status --short)
    if ($SourceRevision) {
        $revision = $SourceRevision
    } else {
        $revision = (& git -C $repoRoot rev-parse HEAD 2>$null | Select-Object -First 1)
        if (-not $revision) { $revision = "unavailable" }
    }
    $sourceType = "git-checkout"
    $workingTreeClean = ($status.Count -eq 0)
}

$os = Get-CimInstance Win32_OperatingSystem
$processors = @(Get-CimInstance Win32_Processor)
$measurements = @($MeasurePath | ForEach-Object { Get-DirectoryMeasurement $_ })
$timestamp = (Get-Date).ToUniversalTime().ToString("o")
$requirementsPath = Join-Path $repoRoot "services/agent/requirements.txt"
$packageLockPath = Join-Path $repoRoot "package-lock.json"
$nodeModulesLockPath = Join-Path $repoRoot "node_modules/.package-lock.json"
$buildScriptPath = Join-Path $repoRoot "scripts/build-agent-runtime.ps1"
$desktopPackagePath = Join-Path $repoRoot "apps/desktop/package.json"
$pythonFreezeHash = "unavailable"
if ($buildPython) {
    try {
        $freeze = (& $buildPython -m pip freeze --all 2>$null | Out-String)
        if ($LASTEXITCODE -eq 0) { $pythonFreezeHash = Get-StringSha256 $freeze }
    } catch {}
}
$installer = $null
if ($InstallerPath) {
    $installerFullPath = if ([System.IO.Path]::IsPathRooted($InstallerPath)) {
        (Resolve-Path -LiteralPath $InstallerPath).Path
    } else {
        (Resolve-Path -LiteralPath (Join-Path $repoRoot $InstallerPath)).Path
    }
    $installerFile = Get-Item -LiteralPath $installerFullPath
    $installer = [ordered]@{
        Path = $installerFullPath
        Bytes = [int64]$installerFile.Length
        Sha256 = (Get-FileHash -LiteralPath $installerFullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

$baseline = [ordered]@{
    schema = 2
    measuredAtUtc = $timestamp
    repository = $repoRoot
    source = [ordered]@{
        type = $sourceType
        revision = [string]$revision
        workingTreeClean = $workingTreeClean
        gitStatus = $status
        overrides = $SourceOverrides
    }
    workingTreeClean = $workingTreeClean
    gitStatus = $status
    environment = [ordered]@{
        os = $os.Caption
        osVersion = $os.Version
        osBuild = $os.BuildNumber
        architecture = $os.OSArchitecture
        node = Get-CommandVersion "node" @("--version")
        npm = Get-CommandVersion "npm" @("--version")
        python = Get-CommandVersion "python" @("--version")
        buildPython = if ($buildPython) { $buildPython } else { "unavailable" }
        buildPythonVersion = if ($buildPython) { Get-CommandVersion $buildPython @("--version") } else { "unavailable" }
        pyInstaller = if ($buildPython) { Get-CommandVersion $buildPython @("-m", "PyInstaller", "--version") } else { "unavailable" }
        processorCount = [int](($processors | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum)
        totalPhysicalMemoryBytes = [int64]$os.TotalVisibleMemorySize * 1024
        requirementsSha256 = if (Test-Path -LiteralPath $requirementsPath) { (Get-FileHash -LiteralPath $requirementsPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { "unavailable" }
        packageLockSha256 = if (Test-Path -LiteralPath $packageLockPath) { (Get-FileHash -LiteralPath $packageLockPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { "unavailable" }
        installedNodeModulesLockSha256 = if (Test-Path -LiteralPath $nodeModulesLockPath) { (Get-FileHash -LiteralPath $nodeModulesLockPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { "unavailable" }
        buildAgentScriptSha256 = if (Test-Path -LiteralPath $buildScriptPath) { (Get-FileHash -LiteralPath $buildScriptPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { "unavailable" }
        desktopPackageSha256 = if (Test-Path -LiteralPath $desktopPackagePath) { (Get-FileHash -LiteralPath $desktopPackagePath -Algorithm SHA256).Hash.ToLowerInvariant() } else { "unavailable" }
        pythonFreezeSha256 = $pythonFreezeHash
    }
    artifacts = $measurements
    installer = $installer
    runtimeComponents = @()
    limitations = @(
        "Directory measurements are valid only for the exact source revision and dependency snapshot recorded above.",
        "Use InstallerPath to record the download artifact size and SHA-256; release folders may contain stale installers.",
        "Agent readiness and idle/active CPU/RAM require a separate isolated process measurement."
    )
}

$runtime = $measurements | Where-Object { $_.Path -eq "apps/desktop/agent-runtime" -and $_.Exists }
if ($runtime) {
    $runtimeRoot = Join-Path $repoRoot "apps/desktop/agent-runtime"
    $baseline.runtimeComponents = @(
        Get-ChildItem -LiteralPath $runtimeRoot -Directory -Recurse -Force |
            ForEach-Object {
                $files = @(Get-ChildItem -LiteralPath $_.FullName -File -Recurse -Force)
                [pscustomobject]@{
                    Path = $_.FullName.Substring($repoRoot.Length + 1)
                    Bytes = [int64](($files | Measure-Object -Property Length -Sum).Sum)
                }
            } |
            Sort-Object Bytes -Descending |
            Select-Object -First 25
    )
}

$json = $baseline | ConvertTo-Json -Depth 8
if ($OutputPath) {
    $absoluteOutput = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
        $OutputPath
    } else {
        Join-Path $repoRoot $OutputPath
    }
    $parent = Split-Path -Parent $absoluteOutput
    if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    Set-Content -LiteralPath $absoluteOutput -Value $json -Encoding utf8
}
$json
