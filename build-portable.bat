@echo off
title TestFlow Portable Build
echo ========================================
echo   TestFlow — Portable Build
echo ========================================
echo.

cd /d "%~dp0"

:: Step 1: Install dependencies if needed
echo [1/3] Checking dependencies...
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo ERROR: npm install failed!
        pause
        exit /b 1
    )
)
echo      Dependencies OK
echo.

:: Step 2: Clean previous build
echo [2/3] Cleaning previous build...
if exist "dist" (
    rmdir /s /q "dist"
    echo      Cleaned dist/
) else (
    echo      No previous build found
)
echo.

:: Step 3: Build portable using electron-packager
echo [3/3] Building TestFlow portable files...
echo      This may take a few minutes...
echo.

call npx @electron/packager . TestFlow --platform=win32 --arch=x64 --out=dist --overwrite --ignore="^/dist$|^/\.git|^/\.vscode|^/testflow\.zip$|^/build-.*\.bat$|^/promt\.txt$"
if %ERRORLEVEL% neq 0 (
    echo.
    echo ========================================
    echo   PORTABLE BUILD FAILED!
    echo ========================================
    echo Check the errors above and try again.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   PORTABLE BUILD SUCCESSFUL!
echo ========================================
echo.
echo Output folder: dist\TestFlow-win32-x64\
echo Run: dist\TestFlow-win32-x64\TestFlow.exe
echo.
echo You can zip this folder and share it.
echo.
pause
