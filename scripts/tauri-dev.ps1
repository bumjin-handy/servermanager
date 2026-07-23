# UTF-8 with BOM recommended for Windows PowerShell 5.1
$ErrorActionPreference = "Continue"
Set-Location (Split-Path -Parent $PSScriptRoot)

$tauriJs = Join-Path (Get-Location) "node_modules\@tauri-apps\cli\tauri.js"
if (-not (Test-Path -LiteralPath $tauriJs)) {
    Write-Host "[error] @tauri-apps/cli not found. Run install.bat first."
    Read-Host "Press Enter to close"
    exit 1
}

Write-Host "Starting Server Manager (tauri dev)..."
Write-Host "Close the app window, or press Ctrl+C once to stop."
Write-Host ""

try {
    & node $tauriJs dev
    $code = $LASTEXITCODE
} finally {
    Write-Host ""
    Write-Host "Stopped. Cleaning up port 14200..."
    try {
        Get-NetTCPConnection -LocalPort 14200 -State Listen -ErrorAction SilentlyContinue |
            ForEach-Object {
                Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
            }
    } catch {
        # ignore cleanup errors
    }
}

if ($null -ne $code -and $code -ne 0) {
    Write-Host "Exit code: $code"
}
Write-Host ""
Read-Host "Press Enter to close"
exit $(if ($null -ne $code) { $code } else { 0 })
