#Requires -Version 5.1
# ============================================================
#  WindowPtero - script cai dat MOT LAN tren Windows Server
#
#  Ghi chu: toan bo chu trong script nay khong dau, de console
#  cua Windows Server khong bi loi font.
#
#  CACH DUNG DE NHAT:
#     bam phai vao "Chay-de-cai-dat.bat" -> Run as administrator
#
#  Hoac chay tay trong PowerShell (Administrator):
#     powershell -ExecutionPolicy Bypass -File .\install.ps1
#
#  Tham so tuy chon:
#     -InstallDir C:\WindowPtero   thu muc cai dat
#     -Access both|port|tunnel     cach vao panel (mac dinh both)
#     -Port 2008                   cong panel
#     -AdminUser admin             ten dang nhap panel
#     -AdminPass "matkhau"         mat khau (de trong = tu sinh)
#     -NoAutoStart                 khong tu chay lai khi VPS reboot
# ============================================================
[CmdletBinding()]
param(
  [string]$InstallDir = 'C:\WindowPtero',
  [ValidateSet('port', 'tunnel', 'both')]
  [string]$Access = 'both',
  [int]$Port = 2008,
  [string]$AdminUser = 'admin',
  [string]$AdminPass = '',
  [switch]$NoAutoStart
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$TASK_PANEL = 'WindowPtero-Panel'
$TASK_TUNNEL = 'WindowPtero-Tunnel'
$FW_RULE = 'WindowPtero Panel'

function Say($m) { Write-Host ('  ' + $m) }
function Step($m) { Write-Host ''; Write-Host ('=== ' + $m) -ForegroundColor Cyan }
function Ok($m) { Write-Host ('  [OK]  ' + $m) -ForegroundColor Green }
function Note($m) { Write-Host ('  [!]   ' + $m) -ForegroundColor Yellow }
function Die($m) {
  Write-Host ''
  Write-Host ('  [LOI] ' + $m) -ForegroundColor Red
  Write-Host ''
  Write-Host '  Chup lai man hinh nay gui cho nguoi nho ban cai la sua duoc.'
  Write-Host ''
  Read-Host 'Bam Enter de dong'
  exit 1
}

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $pr = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Die 'Can chay bang quyen Administrator. Bam phai file Chay-de-cai-dat.bat -> Run as administrator.'
  }
}

function Refresh-Path {
  $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $u = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = ($m + ';' + $u)
}

function New-Pass([int]$len = 20) {
  $chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $bytes = New-Object 'System.Byte[]' $len
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $sb = ''
  foreach ($b in $bytes) { $sb += $chars[$b % $chars.Length] }
  return $sb
}

function Ensure-Node {
  Step 'Buoc 1/6 - Node.js'
  $cur = $null
  try { $cur = (& node -v) 2>$null } catch {}
  if ($cur -and $cur -match '^v(\d+)\.') {
    if ([int]$Matches[1] -ge 18) { Ok ('Da co Node ' + $cur); return }
    Note ('Node ' + $cur + ' qua cu, se cai ban LTS moi hon')
  }
  else { Say 'Chua co Node.js, dang tai ban LTS...' }

  $idx = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
  $lts = $idx | Where-Object { $_.lts } | Select-Object -First 1
  if (-not $lts) { Die 'Khong lay duoc danh sach ban Node LTS tu nodejs.org' }

  $ver = $lts.version
  $url = 'https://nodejs.org/dist/' + $ver + '/node-' + $ver + '-x64.msi'
  $msi = Join-Path $env:TEMP ('node-' + $ver + '-x64.msi')
  Say ('Tai ' + $url)
  Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing
  Say 'Dang cai im lang, doi 1-3 phut...'
  $p = Start-Process msiexec.exe -ArgumentList @('/i', ('"' + $msi + '"'), '/qn', '/norestart') -Wait -PassThru
  if ($p.ExitCode -ne 0) { Die ('Cai Node that bai, ma loi msiexec = ' + $p.ExitCode) }
  Refresh-Path
  $new = $null
  try { $new = (& node -v) 2>$null } catch {}
  if (-not $new) { Die 'Da cai Node nhung chua goi duoc lenh node. Dong cua so nay, mo lai roi chay script lan nua.' }
  Ok ('Da cai Node ' + $new)
}

function Ensure-Java([string]$dir) {
  Step 'Buoc 2/6 - Java (de chay server Minecraft)'
  $have = $false
  try { & java -version 2>&1 | Out-Null; if ($LASTEXITCODE -eq 0) { $have = $true } } catch {}
  if ($have) {
    Ok 'May da co Java san trong PATH'
    return 'java'
  }

  Say 'Chua co Java, dang tai Temurin JRE 21...'
  $rt = Join-Path $dir 'runtime'
  New-Item -ItemType Directory -Force -Path $rt | Out-Null
  $zip = Join-Path $env:TEMP 'temurin-jre21.zip'
  $url = 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse'
  try {
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    if (Test-Path (Join-Path $rt 'jre21')) { Remove-Item (Join-Path $rt 'jre21') -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath (Join-Path $rt 'jre21') -Force
    $exe = Get-ChildItem -Path (Join-Path $rt 'jre21') -Filter 'java.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($exe) {
      Ok ('Da cai Java rieng cho panel: ' + $exe.FullName)
      return $exe.FullName
    }
    Note 'Tai xong nhung khong tim thay java.exe trong goi'
  }
  catch {
    Note ('Khong tai duoc Java: ' + $_.Exception.Message)
  }
  Note 'Bo qua buoc Java. Panel van chay, nhung phai tu cai Java truoc khi bat server Minecraft.'
  return 'java'
}

function Copy-Panel([string]$src, [string]$dst) {
  Step 'Buoc 3/6 - Copy panel'
  if (-not (Test-Path (Join-Path $src 'server.js'))) {
    Die ('Khong thay server.js trong ' + $src + '. Hay giai nen ca folder panel roi chay lai script trong folder deploy.')
  }
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  # Khong dat ten bien la $args - do la bien tu dong cua PowerShell
  $rcArgs = @(
    ('"' + $src + '"'), ('"' + $dst + '"'), '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
    '/XD', 'node_modules', '.git', 'volumes', 'data', 'runtime',
    '/XF', '*.bak', '_*.log', '.env'
  )
  $p = Start-Process robocopy.exe -ArgumentList $rcArgs -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ge 8) { Die ('Copy that bai, robocopy tra ma ' + $p.ExitCode) }
  Ok ('Da copy panel vao ' + $dst)
  Say 'Thu muc data\ va volumes\ (server + tai khoan cu) khong bi ghi de.'
}

function Install-Deps([string]$dir) {
  Step 'Buoc 4/6 - Cai thu vien Node'
  Refresh-Path
  $p = Start-Process cmd.exe -ArgumentList @('/c', ('cd /d "' + $dir + '" && npm install --omit=dev --no-audit --no-fund')) -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) { Die ('npm install that bai, ma loi ' + $p.ExitCode) }
  Ok 'Xong thu vien'
}

function Write-EnvFile([string]$dir, [string]$pass, [string]$javaPath) {
  Step 'Buoc 5/6 - Tao file cau hinh .env'
  $envPath = Join-Path $dir '.env'
  if (Test-Path $envPath) {
    Ok 'Da co .env san, giu nguyen khong ghi de'
    return $null
  }
  $bindHost = '0.0.0.0'
  if ($Access -eq 'tunnel') { $bindHost = '127.0.0.1' }

  $lines = @(
    '# WindowPtero - cau hinh panel. Sua file nay roi restart panel.',
    '# Restart nhanh: schtasks /End /TN WindowPtero-Panel   roi   schtasks /Run /TN WindowPtero-Panel',
    '',
    ('WP_PORT=' + $Port),
    ('WP_HOST=' + $bindHost),
    '',
    ('WP_ADMIN_USER=' + $AdminUser),
    ('WP_ADMIN_PASS=' + $pass),
    '',
    '# =1 khi vao panel bang https (dang dung link Cloudflare thi de 0 cung chay,',
    '# vi Cloudflare da lo phan ma hoa duong truyen)',
    'WP_HTTPS=0',
    '',
    '# Cach vao panel: port | tunnel | both. Chi script cai dat doc bien nay.',
    ('WP_ACCESS=' + $Access),
    '',
    '# Upload: 2GB moi file, 20 file moi lan',
    'WP_MAX_UPLOAD_BYTES=2147483648',
    'WP_MAX_UPLOAD_FILES=20',
    '',
    ('# Java tim thay luc cai: ' + $javaPath)
  )
  Set-Content -Path $envPath -Value $lines -Encoding ASCII
  Ok ('Da tao ' + $envPath)
  return $pass
}

function Write-Runners([string]$dir) {
  $panelCmd = Join-Path $dir 'run-panel.cmd'
  $panel = @(
    '@echo off',
    'rem Chay panel WindowPtero. Tu bat lai neu bi crash.',
    'cd /d "%~dp0"',
    ':loop',
    'node server.js >> "%~dp0_panel.log" 2>&1',
    'timeout /t 5 /nobreak >nul',
    'goto loop'
  )
  Set-Content -Path $panelCmd -Value $panel -Encoding ASCII

  $tunnelCmd = Join-Path $dir 'run-tunnel.cmd'
  $tunnel = @(
    '@echo off',
    'rem Tao link https tam thoi tro ve panel chay o may nay.',
    'cd /d "%~dp0"',
    ':loop',
    ('"%~dp0runtime\cloudflared.exe" tunnel --url http://127.0.0.1:' + $Port + ' --no-autoupdate >> "%~dp0_tunnel.log" 2>&1'),
    'timeout /t 5 /nobreak >nul',
    'goto loop'
  )
  Set-Content -Path $tunnelCmd -Value $tunnel -Encoding ASCII

  $show = Join-Path $dir 'xem-link.cmd'
  $showBody = @(
    '@echo off',
    'rem In ra link truy cap panel hien tai.',
    'type "%~dp0_THONG-TIN-TRUY-CAP.txt" 2>nul',
    'echo.',
    'echo --- Link Cloudflare moi nhat trong log ---',
    'findstr /C:"trycloudflare.com" "%~dp0_tunnel.log" 2>nul',
    'pause'
  )
  Set-Content -Path $show -Value $showBody -Encoding ASCII

  return $panelCmd
}

function Ensure-Cloudflared([string]$dir) {
  $rt = Join-Path $dir 'runtime'
  New-Item -ItemType Directory -Force -Path $rt | Out-Null
  $exe = Join-Path $rt 'cloudflared.exe'
  if (Test-Path $exe) { Ok 'Da co cloudflared'; return $exe }
  Say 'Tai cloudflared (tao link https khong can mo port)...'
  $url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
  try {
    Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
    Ok 'Da tai cloudflared'
    return $exe
  }
  catch {
    Note ('Khong tai duoc cloudflared: ' + $_.Exception.Message)
    return $null
  }
}

function Open-Firewall([int]$p) {
  Say ('Mo cong ' + $p + ' tren firewall...')
  & netsh.exe advfirewall firewall delete rule name="$FW_RULE" 2>&1 | Out-Null
  & netsh.exe advfirewall firewall add rule name="$FW_RULE" dir=in action=allow protocol=TCP localport=$p 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Ok ('Da mo cong ' + $p) } else { Note 'Khong mo duoc firewall, co the phai mo tay trong panel nha cung cap VPS' }
}

function Register-Task([string]$name, [string]$cmdPath) {
  & schtasks.exe /Delete /TN $name /F 2>&1 | Out-Null
  & schtasks.exe /Create /TN $name /TR ('"' + $cmdPath + '"') /SC ONSTART /RU SYSTEM /RL HIGHEST /F 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Note ('Khong tao duoc task ' + $name); return $false }
  & schtasks.exe /Run /TN $name 2>&1 | Out-Null
  return $true
}

function Wait-Health([int]$p) {
  $url = 'http://127.0.0.1:' + $p + '/api/health'
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $r = Invoke-RestMethod -Uri $url -TimeoutSec 3 -UseBasicParsing
      if ($r.ok) { return $true }
    }
    catch { Start-Sleep -Seconds 2 }
  }
  return $false
}

function Get-TunnelLink([string]$dir) {
  $log = Join-Path $dir '_tunnel.log'
  for ($i = 0; $i -lt 45; $i++) {
    if (Test-Path $log) {
      $raw = Get-Content $log -Raw -ErrorAction SilentlyContinue
      if ($raw) {
        $m = [regex]::Match($raw, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($m.Success) { return $m.Value }
      }
    }
    Start-Sleep -Seconds 2
  }
  return $null
}

# ==================== CHAY ====================
Write-Host ''
Write-Host '  ############################################' -ForegroundColor Cyan
Write-Host '  #   WindowPtero - Minecraft Server Panel   #' -ForegroundColor Cyan
Write-Host '  #   Script cai dat tu dong cho Windows     #' -ForegroundColor Cyan
Write-Host '  ############################################' -ForegroundColor Cyan
Write-Host ''
Say ('Thu muc cai dat : ' + $InstallDir)
Say ('Cong panel      : ' + $Port)
Say ('Cach truy cap   : ' + $Access)

Assert-Admin

$srcDir = Split-Path -Parent $PSScriptRoot
if (-not $srcDir) { $srcDir = (Get-Location).Path }

Ensure-Node
$javaPath = Ensure-Java $InstallDir
Copy-Panel $srcDir $InstallDir
Install-Deps $InstallDir

if ([string]::IsNullOrWhiteSpace($AdminPass)) { $AdminPass = New-Pass 20 }
$createdPass = Write-EnvFile $InstallDir $AdminPass $javaPath
$panelCmd = Write-Runners $InstallDir

Step 'Buoc 6/6 - Bat panel'
$cf = $null
if ($Access -ne 'port') { $cf = Ensure-Cloudflared $InstallDir }
if ($Access -ne 'tunnel') { Open-Firewall $Port }

if ($NoAutoStart) {
  Note 'Bo qua tao task tu chay. Bat panel bang cach chay run-panel.cmd.'
  Start-Process cmd.exe -ArgumentList @('/c', ('"' + $panelCmd + '"')) -WindowStyle Minimized
}
else {
  if (Register-Task $TASK_PANEL $panelCmd) { Ok 'Panel se tu chay lai moi khi VPS reboot' }
  if ($cf) {
    if (Register-Task $TASK_TUNNEL (Join-Path $InstallDir 'run-tunnel.cmd')) { Ok 'Link Cloudflare cung tu bat lai khi reboot' }
  }
}

Say 'Dang doi panel len...'
$up = Wait-Health $Port
if ($up) { Ok 'Panel da chay' }
else { Note ('Panel chua tra loi. Xem log tai ' + (Join-Path $InstallDir '_panel.log')) }

$link = $null
if ($cf) {
  Say 'Dang doi Cloudflare tao link (30-60 giay)...'
  $link = Get-TunnelLink $InstallDir
}

$ipList = @()
try {
  $pub = Invoke-RestMethod -Uri 'https://api.ipify.org?format=json' -TimeoutSec 8 -UseBasicParsing
  if ($pub.ip) { $ipList += $pub.ip }
}
catch {}

$info = @()
$info += '================ WINDOWPTERO - THONG TIN TRUY CAP ================'
$info += ''
if ($link) {
  $info += ('Link https (khong can mo port): ' + $link)
  $info += '  Luu y: link nay doi moi khi tunnel chay lai. Chay xem-link.cmd de lay link moi.'
  $info += ''
}
if ($Access -ne 'tunnel') {
  foreach ($ip in $ipList) { $info += ('Vao bang IP: http://' + $ip + ':' + $Port) }
  if ($ipList.Count -eq 0) { $info += ('Vao bang IP: http://<IP-cua-VPS>:' + $Port) }
  $info += ''
}
$info += ('Tai khoan : ' + $AdminUser)
if ($createdPass) { $info += ('Mat khau  : ' + $AdminPass) }
else { $info += 'Mat khau  : giu nguyen theo file .env da co san' }
$info += ''
$info += 'Thu muc cai dat : ' + $InstallDir
$info += 'Sua cau hinh    : ' + (Join-Path $InstallDir '.env')
$info += 'Log panel       : ' + (Join-Path $InstallDir '_panel.log')
$info += ''
$info += 'Restart panel : schtasks /End /TN WindowPtero-Panel  roi  schtasks /Run /TN WindowPtero-Panel'
$info += 'Go bo sach    : chay uninstall.ps1 trong folder deploy'
$info += '=================================================================='

$infoPath = Join-Path $InstallDir '_THONG-TIN-TRUY-CAP.txt'
Set-Content -Path $infoPath -Value $info -Encoding ASCII

Write-Host ''
foreach ($l in $info) { Write-Host ('  ' + $l) -ForegroundColor Green }
Write-Host ''
Say ('Da luu thong tin tren vao: ' + $infoPath)
Write-Host ''
Read-Host 'Xong. Bam Enter de dong'
