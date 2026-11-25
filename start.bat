@echo off
chcp 65001 >nul
setlocal

echo ==================================================
echo      Discord Server Cloner ULTRA v5.3
echo ==================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Download Node.js v18+ from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo [OK] Node.js detected: %NODE_VER%

if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)

echo [INFO] Launching Discord Server Cloner ULTRA v5.3...
echo.
call npx tsx src/index.ts

echo.
pause
endlocal
