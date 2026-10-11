[CmdletBinding()]
param(
    [string]$OutputPath = "",
    [string[]]$MeasurePath = @(
        "apps/desktop/agent-runtime",
        "apps/desktop/release",
        "apps/desktop/dist",
        "apps/desktop/dist-electron"
    )
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
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

function Get-CommandVersion([string]$Command, [string[]]$Arguments) {
    try {
        $value = (& $Command @Arguments 2>$null | Select-Object -First 1)
        return [string]$value
    } catch {
        return "unavailable"
    }
}

$os = Get-CimInstance Win32_OperatingSystem
$status = @(git status --short)
$measurements = @($MeasurePath | ForEach-Object { Get-DirectoryMeasurement $_ })
$timestamp = (Get-Date).ToUniversalTime().ToString("o")

$baseline = [ordered]@{
    schema = 1
    measuredAtUtc = $timestamp
    repository = $repoRoot
    workingTreeClean = ($status.Count -eq 0)
    gitStatus = $status
    environment = [ordered]@{
        os = $os.Caption
        osVersion = $os.Version
        osBuild = $os.BuildNumber
        architecture = $os.OSArchitecture
        node = Get-CommandVersion "node" @("--version")
        npm = Get-CommandVersion "npm" @("--version")
        python = Get-CommandVersion "python" @("--version")
    }
    artifacts = $measurements
    runtimeComponents = @()
    limitations = @(
        "Directory sizes are measurements of the current checkout and do not prove a clean reproducible build.",
        "Installer download size and extracted installed size must be measured from the same newly produced artifact.",
        "Agent startup readiness and idle/active RAM require an isolated process run and are not inferred here."
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
    $absoluteOutput = Join-Path $repoRoot $OutputPath
    $parent = Split-Path -Parent $absoluteOutput
    if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    Set-Content -LiteralPath $absoluteOutput -Value $json -Encoding utf8
}
$json
