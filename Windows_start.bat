@echo off
setlocal
chcp 65001 >nul

set "PROJECT_DIR=%~dp0"
set "PORT=3055"
set "URL=http://localhost:%PORT%/"

cd /d "%PROJECT_DIR%"
title AI生图自动化平台 - 本地服务器

echo ========================================
echo AI生图自动化平台 - 一键启动
echo ========================================
echo 项目目录: %PROJECT_DIR%
echo 访问地址: %URL%
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js 后再运行。
    echo 下载地址: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 npm，请确认 Node.js 安装完整。
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$conn = Get-NetTCPConnection -LocalPort %PORT% -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' } | Select-Object -First 1; if ($conn) { exit 10 } else { exit 0 }"
if "%ERRORLEVEL%"=="10" (
    echo [提示] 检测到 %PORT% 端口已有服务器在运行，直接打开平台页面。
    start "" "%URL%"
    echo.
    echo 页面已打开。如果页面打不开，请关闭占用 %PORT% 端口的旧进程后再运行本脚本。
    echo.
    pause
    exit /b 0
)

if not exist "%PROJECT_DIR%node_modules\express" (
    echo [提示] 未检测到依赖，正在执行 npm install...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [错误] 依赖安装失败，请检查网络或 npm 配置。
        echo.
        pause
        exit /b 1
    )
    echo.
)

echo [提示] 正在启动服务器...
echo 关闭此窗口或按 Ctrl+C 可停止服务器。
echo.

start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$url = '%URL%'; for ($i = 0; $i -lt 45; $i++) { try { Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process $url; exit 0 } catch { Start-Sleep -Seconds 1 } }; Start-Process $url"

node server.js

echo.
echo [提示] 服务器已停止。
pause
