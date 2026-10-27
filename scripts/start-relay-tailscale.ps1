[CmdletBinding()]
param(
    [int]$Port = 8787,
    [string]$OutputFile = '.helix-relay-url.json'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$python = Join-Path $root '.venv\Scripts\python.exe'
$tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
if (-not (Test-Path -LiteralPath $tailscale)) { $tailscale = (Get-Command tailscale.exe -ErrorAction Stop).Source }
$tools = Join-Path $root '.tools'
$relayOut = Join-Path $tools 'helix-relay-tailscale.out.log'
$relayErr = Join-Path $tools 'helix-relay-tailscale.err.log'
$resolvedOutput = Join-Path $root $OutputFile
$ownsOutput = $false
New-Item -ItemType Directory -Path $tools -Force | Out-Null

$env:HELIX_RELAY_HOST = '127.0.0.1'
$env:HELIX_RELAY_PORT = [string]$Port
$relay = Start-Process -FilePath $python -ArgumentList '-m','services.relay.server' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $relayOut -RedirectStandardError $relayErr -PassThru
try {
    Start-Sleep -Milliseconds 800
    if ($relay.HasExited) { throw "El relay local terminó antes de iniciar. Revisa $relayErr" }
    & $tailscale funnel --bg --https=443 ("http://127.0.0.1:{0}" -f $Port) | Out-Null
    $deadline = (Get-Date).AddSeconds(30)
    $relayUrl = $null
    while ((Get-Date) -lt $deadline) {
        $status = (& $tailscale funnel status 2>$null | Out-String)
        $match = [regex]::Match($status, 'https://[a-z0-9.-]+\.ts\.net')
        if ($match.Success) { $relayUrl = $match.Value -replace '^https://','wss://'; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $relayUrl) { throw 'Tailscale Funnel no entregó una URL. Habilítalo en la política del tailnet.' }
    $payload = @{ url = $relayUrl; provider = 'tailscale-funnel'; generatedAt = (Get-Date).ToUniversalTime().ToString('o') }
    [IO.File]::WriteAllText($resolvedOutput, ($payload | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $ownsOutput = $true
    Write-Host "Relay seguro disponible: $relayUrl"
    Write-Host "URL guardada en: $resolvedOutput"
    Write-Host 'Pega esa URL en Toolbox > Mobile Link > Relay preferido.'
    Write-Host 'Mantén esta ventana abierta: el relay local debe permanecer activo.'
    Wait-Process -Id $relay.Id
}
finally {
    if ($relay -and -not $relay.HasExited) { Stop-Process -Id $relay.Id -Force -ErrorAction SilentlyContinue }
    if ($ownsOutput) { Remove-Item -LiteralPath $resolvedOutput -Force -ErrorAction SilentlyContinue }
}
