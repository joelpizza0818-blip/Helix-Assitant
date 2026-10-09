$ErrorActionPreference = "Stop"

$version = "2.102.0"
$expectedSha256 = "ae64e556ecc240b200f7eba60d550e4bb60d78e860e69dd88c449405b86067f4"
$archiveName = "gh_$($version)_windows_amd64.zip"
$downloadUrl = "https://github.com/cli/cli/releases/download/v$version/$archiveName"
$repoRoot = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $repoRoot "apps\desktop\agent-runtime\github-cli"
$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "helix-gh-$([guid]::NewGuid().ToString('N'))"
$archivePath = Join-Path $temporaryDirectory $archiveName

try {
  New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
  Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath

  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  $archiveStream = [System.IO.File]::OpenRead($archivePath)
  try {
    $hashBytes = $sha256.ComputeHash($archiveStream)
  } finally {
    $archiveStream.Dispose()
    $sha256.Dispose()
  }
  $actualSha256 = [System.BitConverter]::ToString($hashBytes).Replace("-", "").ToLowerInvariant()
  if ($actualSha256 -ne $expectedSha256) {
    throw "GitHub CLI archive checksum mismatch. Expected $expectedSha256, got $actualSha256."
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    $entry = $archive.GetEntry("bin/gh.exe")
    if ($null -eq $entry) {
      throw "GitHub CLI archive does not contain bin/gh.exe."
    }
    New-Item -ItemType Directory -Path (Join-Path $destination "bin") -Force | Out-Null
    $outputPath = Join-Path $destination "bin\gh.exe"
    $entryStream = $entry.Open()
    try {
      $outputStream = [System.IO.File]::Create($outputPath)
      try {
        $entryStream.CopyTo($outputStream)
      } finally {
        $outputStream.Dispose()
      }
    } finally {
      $entryStream.Dispose()
    }
    $license = $archive.GetEntry("LICENSE")
    if ($null -ne $license) {
      $licensePath = Join-Path $destination "LICENSE"
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($license, $licensePath, $true)
    }
  } finally {
    $archive.Dispose()
  }

  Write-Host "Staged GitHub CLI v$version ($actualSha256)."
} finally {
  if (Test-Path -LiteralPath $temporaryDirectory) {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
  }
}
