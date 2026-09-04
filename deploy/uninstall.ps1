#Requires -Version 5.1
# ============================================================
#  WindowPtero - go bo sach khoi Windows Server
#
#  Mac dinh: dung panel, xoa task tu chay, dong cong firewall,
#  NHUNG GIU LAI thu muc cai dat (con world Minecraft trong do).
#
#  Muon xoa luon file: chay voi -RemoveFiles
#     powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -RemoveFiles
# ============================================================
[CmdletBinding()]
param(
  [string]$InstallDir = 'C:\WindowPtero',
  [switch]$RemoveFiles
)

$ErrorActionPreference = 'Continue'

function Say($m) { Write-Host ('  ' + $m) }
function Ok($m) { Write-Host ('  [OK]  ' + $m) -ForegroundColor Green }
function Note($m) { Write-Host ('  [!]   ' + $m) -ForegroundColor Yellow }

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host '  [LOI] Can chay bang quyen Administrator.' -ForegroundColor Red
  Read-Host 'Bam Enter de dong'
  exit 1
}

Write-Host ''
Write-Host '  === Go bo WindowPtero ===' -ForegroundColor Cyan
Write-Host ''

foreach ($t in @('WindowPtero-Panel', 'WindowPtero-Tunnel')) {
  & schtasks.exe /End /TN $t 2>&1 | Out-Null
  & schtasks.exe /Delete /TN $t /F 2>&1 | Out-Null
  Ok ('Da xoa task ' + $t)
}

# Dung tien trinh con sot lai
foreach ($n in @('cloudflared')) {
  Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -like '*server.js*' } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Ok ('Da dung node.exe PID ' + $_.ProcessId)
  }

& netsh.exe advfirewall firewall delete rule name="WindowPtero Panel" 2>&1 | Out-Null
Ok 'Da xoa rule firewall'

if ($RemoveFiles) {
  if (Test-Path $InstallDir) {
    Note ('Sap xoa toan bo ' + $InstallDir + ' (ke ca world Minecraft)')
    $ans = Read-Host 'Chac chan? Go chu XOA roi Enter'
    if ($ans -eq 'XOA') {
      Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
      Ok ('Da xoa ' + $InstallDir)
    }
    else { Say 'Bo qua, khong xoa file.' }
  }
}
else {
  Say ('Giu lai thu muc ' + $InstallDir + ' (them -RemoveFiles neu muon xoa het)')
}

Write-Host ''
Ok 'Xong. Node.js va Java neu da cai thi van con, go trong Apps & features neu muon.'
Write-Host ''
Read-Host 'Bam Enter de dong'
