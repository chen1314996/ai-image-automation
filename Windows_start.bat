@echo off
setlocal

rem Compatibility wrapper. The real starter is Windows_start.cmd.
rem Kept small on purpose so security tools can read it easily.

set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%Windows_start.cmd" (
    call "%SCRIPT_DIR%Windows_start.cmd"
) else (
    echo Windows_start.cmd was not found.
    echo Please run Windows_start.cmd from the project folder.
    echo.
    pause
    exit /b 1
)
