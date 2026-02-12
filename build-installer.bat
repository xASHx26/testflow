@echo off
title TestFlow Build
echo ========================================
echo   TestFlow — Build ^& Push
echo ========================================
echo.

:: Move to project directory
cd /d "%~dp0"

:: Step 1: Install dependencies if needed
echo [1/4] Checking dependencies...
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
echo [2/4] Cleaning previous build...
if exist "dist" (
    rmdir /s /q "dist"
    echo      Cleaned dist/
) else (
    echo      No previous build found
)
echo.

:: Step 3: Build the installer using electron-builder (NSIS Setup .exe)
echo [3/4] Building TestFlow Setup installer...
echo      This may take a few minutes...
echo.

:: Disable code signing to avoid symlink issues on non-admin Windows
set CSC_IDENTITY_AUTO_DISCOVERY=false
set CSC_LINK=

call npx electron-builder --win --config
if %ERRORLEVEL% neq 0 (
    echo.
    echo ========================================
    echo   BUILD FAILED!
    echo ========================================
    echo Check the errors above and try again.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   BUILD SUCCESSFUL!
echo ========================================

:: Show output
echo.
echo Built installer:
for %%f in (dist\*.exe) do (
    echo   %%~nxf  ^(%%~zf bytes^)
)
echo.
echo Share the "TestFlow Setup *.exe" file from dist\
echo Users just double-click it to install.

:: Step 4: Git commit and push
echo [4/4] Pushing to Git...
echo.

:: Stage all changes (dist is in .gitignore so it won't be included)
git add -A
if %ERRORLEVEL% neq 0 (
    echo ERROR: git add failed!
    pause
    exit /b 1
)

:: Check if there are changes to commit
git diff --cached --quiet
if %ERRORLEVEL% equ 0 (
    echo      No changes to commit — already up to date.
) else (
    :: Get current date/time for commit message
    for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH:mm"') do set TIMESTAMP=%%i

    git commit -m "build: TestFlow v1.0.0-alpha — %TIMESTAMP%"
    if %ERRORLEVEL% neq 0 (
        echo ERROR: git commit failed!
        pause
        exit /b 1
    )
)

git push
if %ERRORLEVEL% neq 0 (
    echo ERROR: git push failed!
    echo You may need to set up your remote or authenticate.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   ALL DONE!
echo   Installer: dist\TestFlow Setup *.exe
echo   Git: pushed to remote
echo ========================================
echo.
pause
