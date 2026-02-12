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

:: Step 3: Build the app using electron-packager (no code signing issues)
echo [3/4] Building TestFlow for Windows...
echo      This may take a few minutes...
echo.
call npx @electron/packager . TestFlow --platform=win32 --arch=x64 --out=dist --overwrite --icon=assets/icon.png --ignore="^/dist$|^/\.git|^/\.vscode|^/node_modules/puppeteer"
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
echo Built to: dist\TestFlow-win32-x64\
if exist "dist\TestFlow-win32-x64\TestFlow.exe" (
    echo   TestFlow.exe found!
) else (
    echo   WARNING: TestFlow.exe not found in output
)
echo.

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
    for /f "tokens=2 delims==" %%i in ('wmic os get localdatetime /value') do set dt=%%i
    set TIMESTAMP=%dt:~0,4%-%dt:~4,2%-%dt:~6,2% %dt:~8,2%:%dt:~10,2%

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
echo   Build: dist\TestFlow-win32-x64\
echo   Git: pushed to remote
echo ========================================
echo.
pause
