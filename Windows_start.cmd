@echo off
setlocal EnableExtensions

rem AI image automation platform - safe Windows starter.
rem Double-click this file to install missing project dependencies,
rem start the local server, and open the web UI.

set "PROJECT_DIR=%~dp0"
set "PORT=3055"
set "URL=http://localhost:%PORT%/"

cd /d "%PROJECT_DIR%"
title AI Image Automation Platform Server

echo ========================================
echo AI Image Automation Platform
echo Safe one-click starter for Windows
echo ========================================
echo Project: %PROJECT_DIR%
echo URL:     %URL%
echo.

echo [1/5] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found.
    echo Trying to install Node.js LTS with winget...
    echo.

    where winget >nul 2>nul
    if errorlevel 1 (
        echo winget was not found on this computer.
        echo Please install Node.js LTS from:
        echo https://nodejs.org/
        echo.
        pause
        exit /b 1
    )

    winget install --id OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo.
        echo Node.js installation failed.
        echo Please install Node.js LTS from:
        echo https://nodejs.org/
        echo.
        pause
        exit /b 1
    )

    set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"
    where node >nul 2>nul
    if errorlevel 1 (
        echo.
        echo Node.js was installed, but this window cannot find it yet.
        echo Close this window and double-click Windows_start.cmd again.
        echo.
        pause
        exit /b 1
    )
)
for /f "tokens=*" %%v in ('node --version') do set "NODE_VERSION=%%v"
echo Node.js: %NODE_VERSION%
echo.

echo [2/5] Checking npm...
where npm >nul 2>nul
if errorlevel 1 (
    set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"
    where npm >nul 2>nul
)
if errorlevel 1 (
    echo npm was not found. Please repair or reinstall Node.js.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('npm --version') do set "NPM_VERSION=%%v"
echo npm: %NPM_VERSION%
echo.

echo [3/5] Checking project dependencies...
set "NEED_NPM_INSTALL=0"
if not exist "%PROJECT_DIR%node_modules\express\package.json" set "NEED_NPM_INSTALL=1"
if not exist "%PROJECT_DIR%node_modules\playwright\package.json" set "NEED_NPM_INSTALL=1"
if not exist "%PROJECT_DIR%node_modules\canvas\package.json" set "NEED_NPM_INSTALL=1"

if "%NEED_NPM_INSTALL%"=="1" (
    echo Missing npm dependencies. Running npm install...
    echo This may take a few minutes.
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed. Please check the network and npm registry.
        echo.
        pause
        exit /b 1
    )
) else (
    echo npm dependencies already exist.
)
echo.

echo [4/5] Checking Playwright browser files...
node -e "const { chromium } = require('playwright'); const fs = require('fs'); process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1)"
if errorlevel 1 (
    echo Playwright browser files were not found. Installing Chromium...
    call npx playwright install chromium
    if errorlevel 1 (
        echo.
        echo Playwright Chromium installation failed.
        echo You can retry by double-clicking this file again.
        echo.
        pause
        exit /b 1
    )
) else (
    echo Playwright browser files already exist.
)
echo.

echo [5/5] Starting platform...
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>nul
if not errorlevel 1 (
    echo Port %PORT% already has a running service.
    echo This window did not start that service, so Ctrl+C here cannot stop it.
    echo Opening the platform page directly.
    start "" "%URL%"
    echo.
    echo If you want this window to control the server, close the old server first,
    echo then double-click Windows_start.cmd again.
    echo.
    pause
    exit /b 0
)

echo This window will now run the server.
echo Keep this window open while using the platform.
echo Press Ctrl+C in this window to stop the server.
echo The platform page will open automatically in a few seconds.
echo.

start "" /b cmd /c "ping 127.0.0.1 -n 6 >nul && explorer.exe %URL%"

call npm start
set "SERVER_EXIT_CODE=%ERRORLEVEL%"

echo.
echo Server stopped.
echo.
pause
exit /b %SERVER_EXIT_CODE%
