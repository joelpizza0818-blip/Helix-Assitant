[CmdletBinding()]
param(
    [ValidateSet('Auto', 'Tailscale', 'Ssh', 'Cloudflare')]
    [string]$Provider = 'Auto',
    [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sshScript = Join-Path $PSScriptRoot 'start-relay-ssh-tunnel.ps1'
$cloudflareScript = Join-Path $PSScriptRoot 'start-relay-quick-tunnel.ps1'
$tailscaleScript = Join-Path $PSScriptRoot 'start-relay-tailscale.ps1'

function Start-RelayProvider([string]$scriptPath) {
    if (-not (Test-Path -LiteralPath $scriptPath)) { throw "No se encontró $scriptPath" }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -Port $Port
    if ($LASTEXITCODE -ne 0) { throw "El proveedor terminó con código $LASTEXITCODE" }
}

if ($Provider -eq 'Ssh') {
    Start-RelayProvider $sshScript
    exit 0
}

if ($Provider -eq 'Tailscale') {
    Start-RelayProvider $tailscaleScript
    exit 0
}

if ($Provider -eq 'Cloudflare') {
    Start-RelayProvider $cloudflareScript
    exit 0
}

Write-Host 'Proveedor automático: Cloudflare Quick Tunnel (gratuito, temporal, sin dominio ni cuenta).'
Write-Host 'Si falla, no se cambia a otro proveedor: revisa el error o selecciónalo explícitamente.'
Start-RelayProvider $cloudflareScript
