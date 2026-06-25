@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Double-click starter for the current project.
rem It restarts only the service that is listening on PORT, then starts this folder.

set "PROJECT_DIR=%~dp0"
set "PORT=3066"
set "URL=http://localhost:%PORT%/?fresh=%RANDOM%%RANDOM%"

cd /d "%PROJECT_DIR%"
if errorlevel 1 (
    echo Cannot enter project folder:
    echo %PROJECT_DIR%
    echo.
    pause
    exit /b 1
)

title AI Image Automation Platform - Double Click Starter

echo ========================================
echo AI Image Automation Platform
echo Double-click starter
echo ========================================
echo Project: %PROJECT_DIR%
echo Port:    %PORT%
echo URL:     %URL%
echo.

echo [1/5] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found.
    echo Please install Node.js LTS, then double-click this file again:
    echo https://nodejs.org/
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set "NODE_VERSION=%%v"
echo Node.js: %NODE_VERSION%
echo.

echo [2/5] Checking npm...
where npm >nul 2>nul
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

if "%NEED_NPM_INSTALL%"=="1" (
    echo Missing npm dependencies. Running npm install...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed.
        echo.
        pause
        exit /b 1
    )
) else (
    echo npm dependencies already exist.
)
echo.

echo [4/5] Restarting service on port %PORT%...
set "FOUND_PORT_PROCESS=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
    if not "%%p"=="" (
        if not "!KILLED_%%p!"=="1" (
            set "KILLED_%%p=1"
            set "FOUND_PORT_PROCESS=1"
            echo Stopping old service PID %%p...
            taskkill /PID %%p /F >nul 2>nul
        )
    )
)

if "%FOUND_PORT_PROCESS%"=="0" (
    echo No old service found on port %PORT%.
) else (
    timeout /t 2 /nobreak >nul
    netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>nul
    if not errorlevel 1 (
        echo Port %PORT% is still occupied.
        echo Please close the old server window and double-click this file again.
        echo.
        pause
        exit /b 1
    )
    echo Old service stopped.
)
echo.

echo [5/5] Starting current project...
echo Keep this window open while using the platform.
echo Press Ctrl+C in this window to stop the server.
echo The page will open automatically in a few seconds.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -WindowStyle Hidden -FilePath powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -Command ""Start-Sleep -Seconds 4; Start-Process ''%URL%''""'"

call npm start
set "SERVER_EXIT_CODE=%ERRORLEVEL%"

echo.
echo Server stopped.
echo.
pause
exit /b %SERVER_EXIT_CODE%
