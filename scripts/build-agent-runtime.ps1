$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeRoot = Join-Path $repoRoot "apps\desktop\agent-runtime"
$workRoot = Join-Path $repoRoot "apps\desktop\.pyinstaller-work"
$specRoot = Join-Path $repoRoot "apps\desktop\.pyinstaller-spec"

$pythonCandidates = @(
    (Join-Path $repoRoot "services\agent\.venv\Scripts\python.exe"),
    (Join-Path $repoRoot ".venv\Scripts\python.exe")
)
$python = $pythonCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $python) {
    throw "A Windows Python environment is required to build the bundled HELIX agent. Run scripts/setup.ps1 first."
}

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
$pyInstallerVersion = & $python -m PyInstaller --version 2>$null
$pyInstallerExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
if ($pyInstallerExitCode -ne 0) {
    throw "PyInstaller is not installed in $python. Install the build dependency with: $python -m pip install pyinstaller"
}

New-Item -ItemType Directory -Force -Path $runtimeRoot, $workRoot, $specRoot | Out-Null
Get-ChildItem -LiteralPath $runtimeRoot -Force |
    Where-Object { $_.Name -ne ".gitkeep" } |
    Remove-Item -Recurse -Force

$dataSource = Join-Path $repoRoot "services\agent"
$launcher = Join-Path $repoRoot "scripts\helix_agent_launcher.py"
$dataMapping = "$dataSource;services/agent"
$testModuleExclusions = @("--exclude-module", "services.agent.tests")
Get-ChildItem -LiteralPath (Join-Path $dataSource "tests") -Filter "*.py" -File |
    Where-Object { $_.BaseName -ne "__init__" } |
    ForEach-Object {
        $testModuleExclusions += @("--exclude-module", "services.agent.tests.$($_.BaseName)")
    }

& $python -m PyInstaller `
    --noconfirm `
    --onedir `
    --noconsole `
    --name helix-agent `
    --distpath $runtimeRoot `
    --workpath $workRoot `
    --specpath $specRoot `
    --paths $repoRoot `
    --paths (Join-Path $repoRoot "services\agent") `
    --add-data $dataMapping `
    @testModuleExclusions `
    --collect-submodules services.agent `
    --collect-submodules core `
    --collect-submodules ai `
    --collect-submodules browser `
    --collect-submodules memory `
    --collect-submodules mcp `
    --collect-submodules models `
    --collect-submodules perception `
    --collect-submodules plugins `
    --collect-submodules security `
    --collect-submodules skills `
    --collect-submodules tasks `
    --collect-submodules tools `
    --collect-submodules edge_tts `
    --hidden-import win32process `
    --hidden-import win32gui `
    --hidden-import win32con `
    --hidden-import win32clipboard `
    --hidden-import pythoncom `
    --hidden-import win32com.client `
    --copy-metadata edge-tts `
    $launcher

if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed to build the bundled HELIX agent."
}

$agentExecutable = Join-Path $runtimeRoot "helix-agent\helix-agent.exe"
if (-not (Test-Path $agentExecutable)) {
    throw "PyInstaller completed without producing $agentExecutable"
}

Write-Host "Bundled HELIX agent: $agentExecutable" -ForegroundColor Green
