$ErrorActionPreference = "Stop"

Write-Host "Setting up HELIX Environment..." -ForegroundColor Cyan

# Check Node.js
try {
    $nodeVersion = node --version
    Write-Host "Node.js detected: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "Node.js is not installed or not in PATH." -ForegroundColor Red
    exit 1
}

# Check Python
try {
    $pyVersion = python --version
    Write-Host "Python detected: $pyVersion" -ForegroundColor Green
} catch {
    Write-Host "Python is not installed or not in PATH." -ForegroundColor Red
    exit 1
}

# Copy .env.example
if (-not (Test-Path ".env")) {
    Write-Host "Creating .env file from .env.example..." -ForegroundColor Yellow
    Copy-Item ".env.example" -Destination ".env"
    Write-Host ".env created. Please configure your API keys." -ForegroundColor Green
} else {
    Write-Host ".env already exists." -ForegroundColor Green
}

# NPM Install
Write-Host "Installing Node dependencies..." -ForegroundColor Yellow
npm install

# Setup Python venv
$agentDir = "services\agent"
$venvDir = "$agentDir\.venv"

if (-not (Test-Path $agentDir)) {
    New-Item -ItemType Directory -Path $agentDir | Out-Null
}

if (-not (Test-Path $venvDir)) {
    Write-Host "Creating Python virtual environment in $venvDir..." -ForegroundColor Yellow
    python -m venv $venvDir
} else {
    Write-Host "Python virtual environment already exists." -ForegroundColor Green
}

# Setup dummy requirements if not exists for install step
$reqFile = "$agentDir\requirements.txt"
if (-not (Test-Path $reqFile)) {
    New-Item -ItemType File -Path $reqFile | Out-Null
}

Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
& "$venvDir\Scripts\pip.exe" install -r $reqFile

Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "Next steps:"
Write-Host "1. Edit .env to add your keys"
Write-Host "2. Run 'npm run dev' to start"
