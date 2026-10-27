[CmdletBinding()]
param(
    [int]$Port = 8787,
    [string]$RelayHost = '127.0.0.1',
    [string]$OutputFile = '.helix-relay-url.json',
    [switch]$NoInstall
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$toolsDir = Join-Path $repoRoot '.tools'
$cloudflared = Join-Path $toolsDir 'cloudflared.exe'
$relayLog = Join-Path $toolsDir 'helix-relay.out.log'
$relayErrorLog = Join-Path $toolsDir 'helix-relay.err.log'
$tunnelLog = Join-Path $toolsDir 'helix-cloudflared.log'
$tunnelErrorLog = Join-Path $toolsDir 'helix-cloudflared.err.log'
$resolvedOutput = Join-Path $repoRoot $OutputFile
$ownsOutput = $false
New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null

Write-Warning 'Este relay aún no separa la identidad Desktop/móvil ni aplica permisos por dispositivo.'
Write-Warning 'Úsalo solo en pruebas con tus propios dispositivos; no envíes datos sensibles ni compartas el token.'
$confirmation = Read-Host '¿Exponer el relay temporalmente a Internet con Cloudflare Quick Tunnel? [y/N]'
if ($confirmation -notmatch '^(?i:y|yes)$') {
    throw 'Inicio del túnel cancelado.'
}

if (-not (Test-Path -LiteralPath $cloudflared)) {
    if ($NoInstall) { throw "cloudflared.exe no está instalado. Ejecuta sin -NoInstall para descargarlo desde Cloudflare." }
    $url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    Write-Host 'Descargando cloudflared oficial…'
    Invoke-WebRequest -Uri $url -OutFile $cloudflared
}

$python = Join-Path $repoRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw "No se encontró el entorno Python: $python" }

$env:HELIX_RELAY_HOST = $RelayHost
$env:HELIX_RELAY_PORT = [string]$Port
$relay = Start-Process -FilePath $python -ArgumentList '-m','services.relay.server' -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $relayLog -RedirectStandardError $relayErrorLog -PassThru
$tunnel = $null
try {
    $relayDeadline = (Get-Date).AddSeconds(15)
    $relayReady = $false
    while ((Get-Date) -lt $relayDeadline) {
        if ($relay.HasExited) { throw "El relay local terminó al iniciar. Revisa $relayErrorLog" }
        $client = [System.Net.Sockets.TcpClient]::new()
        try {
            $client.Connect($RelayHost, $Port)
            $relayReady = $true
            break
        } catch [System.Net.Sockets.SocketException] {
            Start-Sleep -Milliseconds 250
        } finally {
            $client.Dispose()
        }
    }
    if (-not $relayReady) { throw "El relay local no abrió $RelayHost`:$Port en 15 segundos. Revisa $relayErrorLog" }

    $tunnel = Start-Process -FilePath $cloudflared -ArgumentList 'tunnel','--no-autoupdate','--url',("http://{0}:{1}" -f $RelayHost,$Port) -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $tunnelLog -RedirectStandardError $tunnelErrorLog -PassThru
    $deadline = (Get-Date).AddSeconds(30)
    $relayUrl = $null
    while ((Get-Date) -lt $deadline) {
        if ($tunnel.HasExited) { throw "cloudflared terminó antes de crear el túnel. Revisa $tunnelErrorLog" }
        foreach ($logPath in @($tunnelLog, $tunnelErrorLog)) {
            if (Test-Path -LiteralPath $logPath) {
                $match = Select-String -LiteralPath $logPath -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -Last 1
                if ($match) { $relayUrl = $match.Matches[0].Value -replace '^https://','wss://' ; break }
            }
        }
        if ($relayUrl) { break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $relayUrl) { throw "Cloudflare Quick Tunnel no entregó una URL en 30 segundos. Revisa $tunnelLog y $tunnelErrorLog" }
    $payload = @{ url = $relayUrl; provider = 'cloudflare-quick-tunnel'; generatedAt = (Get-Date).ToUniversalTime().ToString('o') }
    [IO.File]::WriteAllText($resolvedOutput, ($payload | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $ownsOutput = $true
    Write-Host "Relay seguro disponible: $relayUrl"
    Write-Host "URL guardada en: $resolvedOutput"
    Write-Host 'Pega esa URL en Toolbox > Mobile Link > Relay preferido.'
    Write-Host 'Mantén esta ventana abierta: la URL es temporal y cambia al reiniciar.'
    Wait-Process -Id $tunnel.Id
}
finally {
    if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
    if ($relay -and -not $relay.HasExited) { Stop-Process -Id $relay.Id -Force -ErrorAction SilentlyContinue }
    if ($ownsOutput) { Remove-Item -LiteralPath $resolvedOutput -Force -ErrorAction SilentlyContinue }
}
