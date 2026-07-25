@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title MemeMaster Launcher

echo.
echo  === MemeMaster 启动 ===
echo  目录: %CD%
echo.

REM --- free ports 3000 / 8000 (only LISTENING) ---
for %%P in (3000 8000) do (
  for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /R /C:":%%P .*LISTENING"') do (
    if not "%%a"=="0" if not "%%a"=="" (
      echo  释放端口 %%P  pid=%%a
      taskkill /F /PID %%a >nul 2>&1
    )
  )
)

timeout /t 1 /nobreak >nul

if not exist "%~dp0.venv\Scripts\python.exe" (
  echo  [错误] 找不到 .venv\Scripts\python.exe
  echo  请先:  python -m venv .venv
  echo  然后:  .venv\Scripts\pip install -r backend\requirements.txt
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo  [错误] 找不到 node，请安装 Node.js 后重开终端
  pause
  exit /b 1
)

if not exist "%~dp0frontend\node_modules\next" (
  echo  首次运行，正在 npm install ...
  pushd "%~dp0frontend"
  call npm install
  if errorlevel 1 (
    echo  [错误] npm install 失败
    popd
    pause
    exit /b 1
  )
  popd
)

echo  启动后端  http://127.0.0.1:8000 ...
REM 勿写 cd /d "%~dp0" 嵌套引号：路径尾部 \ 会把引号截断导致窗口秒关
start "MemeMaster-API" cmd /k "cd /d %~dp0 & title MemeMaster-API & .venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload"

timeout /t 2 /nobreak >nul

echo  启动前端  http://127.0.0.1:3000 ...
start "MemeMaster-FE" cmd /k "cd /d %~dp0frontend & title MemeMaster-FE & npm run dev -- -H 127.0.0.1 -p 3000"

echo.
echo  等待服务就绪...
set OK_API=0
set OK_FE=0
for /L %%i in (1,1,25) do (
  if !OK_API! equ 0 (
    curl.exe -s -o nul -m 2 http://127.0.0.1:8000/api/health >nul 2>&1
    if not errorlevel 1 set OK_API=1
  )
  if !OK_FE! equ 0 (
    curl.exe -s -o nul -m 2 http://127.0.0.1:3000 >nul 2>&1
    if not errorlevel 1 set OK_FE=1
  )
  if !OK_API! equ 1 if !OK_FE! equ 1 goto :ready
  timeout /t 1 /nobreak >nul
)

:ready
echo.
if "!OK_API!"=="1" (echo  [OK] API   http://127.0.0.1:8000) else (echo  [!!] API 未就绪 — 请看「MemeMaster-API」窗口)
if "!OK_FE!"=="1"  (echo  [OK] Web   http://127.0.0.1:3000) else (echo  [!!] 前端未就绪 — 请看「MemeMaster-FE」窗口)
echo.
echo  浏览器打开:  http://127.0.0.1:3000
echo  不要关闭弹出的两个黑色窗口（关掉 = 服务停）
echo.

if "!OK_FE!"=="1" start "" http://127.0.0.1:3000

pause
endlocal
