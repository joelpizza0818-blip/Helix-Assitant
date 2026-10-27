[CmdletBinding()]
param(
    [int]$Port = 8787,
    [string]$OutputFile = '.helix-relay-url.json'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$python = Join-Path $repoRoot '.venv\Scripts\python.exe'
$ssh = (Get-Command ssh.exe -ErrorAction Stop).Source
$toolsDir = Join-Path $repoRoot '.tools'
$relayOut = Join-Path $toolsDir 'helix-relay-ssh.out.log'
$relayErr = Join-Path $toolsDir 'helix-relay-ssh.err.log'
$sshLog = Join-Path $toolsDir 'helix-ssh-tunnel.out.log'
$sshErr = Join-Path $toolsDir 'helix-ssh-tunnel.err.log'
$resolvedOutput = Join-Path $repoRoot $OutputFile
$ownsOutput = $false
New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
Remove-Item -LiteralPath $relayOut,$relayErr,$sshLog,$sshErr -Force -ErrorAction SilentlyContinue

$env:HELIX_RELAY_HOST = '127.0.0.1'
$env:HELIX_RELAY_PORT = [string]$Port
$relay = Start-Process -FilePath $python -ArgumentList '-m','services.relay.server' -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $relayOut -RedirectStandardError $relayErr -PassThru
$tunnel = $null
try {
    Start-Sleep -Milliseconds 800
    if ($relay.HasExited) {
        throw "El proceso local del relay terminó antes de abrir el túnel. Revisa $relayErr"
    }
    $args = @('-o','StrictHostKeyChecking=accept-new','-o','ExitOnForwardFailure=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=4','-R',("80:127.0.0.1:{0}" -f $Port),'nokey@localhost.run')
    $tunnel = Start-Process -FilePath $ssh -ArgumentList $args -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $sshLog -RedirectStandardError $sshErr -PassThru
    $deadline = (Get-Date).AddSeconds(60)
    $relayUrl = $null
    while ((Get-Date) -lt $deadline) {
        if ($tunnel.HasExited) {
            $tail = @()
            foreach ($log in @($sshLog,$sshErr)) {
                if (Test-Path -LiteralPath $log) { $tail += Get-Content -LiteralPath $log -Tail 8 -ErrorAction SilentlyContinue }
            }
            throw "localhost.run cerró SSH antes de entregar una URL. $($tail -join ' ')"
        }
        if ((Test-Path -LiteralPath $sshLog) -or (Test-Path -LiteralPath $sshErr)) {
            $match = Select-String -Path $sshLog,$sshErr -Pattern 'https://[a-z0-9-]+\.lhr\.life' -ErrorAction SilentlyContinue | Select-Object -Last 1
            if ($match) { $relayUrl = $match.Matches[0].Value -replace '^https://','wss://' ; break }
        }
        Start-Sleep -Milliseconds 500
    }
    if (-not $relayUrl) { throw "localhost.run no entregó una URL en 60 segundos. Revisa $sshLog y $sshErr" }
    $payload = @{ url = $relayUrl; provider = 'localhost.run-ssh'; generatedAt = (Get-Date).ToUniversalTime().ToString('o') }
    [IO.File]::WriteAllText($resolvedOutput, ($payload | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $ownsOutput = $true
    Write-Host "Relay seguro disponible: $relayUrl"
    Write-Host "URL guardada en: $resolvedOutput"
    Write-Host 'Pega esa URL en Toolbox > Mobile Link > Relay preferido.'
    Write-Host 'Mantén esta ventana abierta: la URL temporal se revoca al cerrar SSH.'
    Wait-Process -Id $tunnel.Id
}
finally {
    if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
    if ($relay -and -not $relay.HasExited) { Stop-Process -Id $relay.Id -Force -ErrorAction SilentlyContinue }
    if ($ownsOutput) { Remove-Item -LiteralPath $resolvedOutput -Force -ErrorAction SilentlyContinue }
}
