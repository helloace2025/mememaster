# MemeMaster local dev
# powershell -ExecutionPolicy Bypass -File start-dev.ps1
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Stop-Port([int]$Port) {
  try {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object {
        try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
      }
  } catch {}
}

function Test-Url([string]$Url) {
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $r.StatusCode -ge 200 -and $r.StatusCode -lt 500
  } catch { return $false }
}

Write-Host ""
Write-Host "=== MemeMaster 启动 ===" -ForegroundColor Cyan
Write-Host "目录: $Root"
Write-Host ""

$py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
  Write-Host "[错误] 找不到 .venv，正在创建..." -ForegroundColor Yellow
  python -m venv .venv
  & $py -m pip install -r (Join-Path $Root "backend\requirements.txt")
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "[错误] 找不到 node，请安装 Node.js" -ForegroundColor Red
  Read-Host "按回车退出"
  exit 1
}

if (-not (Test-Path (Join-Path $Root "frontend\node_modules\next"))) {
  Write-Host "npm install..." -ForegroundColor Yellow
  Push-Location (Join-Path $Root "frontend")
  npm install
  Pop-Location
}

Write-Host "释放端口 3000 / 8000 ..." -ForegroundColor Yellow
Stop-Port 8000
Stop-Port 3000
Start-Sleep -Seconds 1

Write-Host "启动后端 :8000 ..." -ForegroundColor Yellow
Start-Process -FilePath "cmd.exe" -ArgumentList @(
  "/k", "cd /d `"$Root`" & title MemeMaster-API & `"$py`" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload"
)

Start-Sleep -Seconds 2

Write-Host "启动前端 :3000 ..." -ForegroundColor Yellow
$fe = Join-Path $Root "frontend"
Start-Process -FilePath "cmd.exe" -ArgumentList @(
  "/k", "cd /d `"$fe`" & title MemeMaster-FE & npm run dev -- -H 127.0.0.1 -p 3000"
)

Write-Host "等待服务就绪..." -ForegroundColor Yellow
$okApi = $false
$okFe = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  if (-not $okApi) {
    if (Test-Url "http://127.0.0.1:8000/api/health") {
      $okApi = $true
      Write-Host "  [OK] API  http://127.0.0.1:8000" -ForegroundColor Green
    }
  }
  if (-not $okFe) {
    if (Test-Url "http://127.0.0.1:3000") {
      $okFe = $true
      Write-Host "  [OK] Web  http://127.0.0.1:3000" -ForegroundColor Green
    }
  }
  if ($okApi -and $okFe) { break }
}

if (-not $okApi) { Write-Host "  [!!] API 未就绪 — 看 MemeMaster-API 窗口" -ForegroundColor Red }
if (-not $okFe)  { Write-Host "  [!!] 前端未就绪 — 看 MemeMaster-FE 窗口" -ForegroundColor Red }

Write-Host ""
Write-Host "打开:  http://127.0.0.1:3000" -ForegroundColor Cyan
Write-Host "不要关闭弹出的两个黑色窗口" -ForegroundColor Yellow
Write-Host ""

if ($okFe) { Start-Process "http://127.0.0.1:3000" }

Read-Host "按回车关闭本启动器（服务继续跑）"
