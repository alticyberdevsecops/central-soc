@echo off
:: ─────────────────────────────────────────────────────────────────────────────
:: build_windows.bat  —  XSIAM Dashboard  Windows Build Script
:: Produces:  dist\XSIAM Dashboard\XSIAM Dashboard.exe  (portable)
::            dist\XSIAM_Dashboard_Setup_1.0.0.exe      (installer, if Inno Setup found)
::
:: Requirements on the build machine (one-time):
::   1. Install Python 3.11+ from https://python.org
::      ✓ Check "Add Python to PATH" during install
::   2. Double-click this .bat file — it handles everything else
::
:: The resulting installer requires NOTHING on end-user Windows machines.
:: ─────────────────────────────────────────────────────────────────────────────
setlocal EnableDelayedExpansion
title XSIAM Dashboard - Windows Build

set APP_NAME=XSIAM Dashboard
set VERSION=1.0.0
set BUNDLE_ID=in.altisec.xsiam-dashboard
set SCRIPT_DIR=%~dp0
:: Remove trailing backslash
if "%SCRIPT_DIR:~-1%"=="\" set SCRIPT_DIR=%SCRIPT_DIR:~0,-1%

echo.
echo ╔══════════════════════════════════════════════════════════════╗
echo ║        XSIAM Dashboard — Windows Build                      ║
echo ║        AltISec Security  ^|  v%VERSION%                         ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.

:: ── Check Python ─────────────────────────────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found.
    echo.
    echo   Please install Python 3.11+ from:  https://www.python.org/downloads/
    echo   IMPORTANT: Check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo [OK] Python %PY_VER% detected
echo.

:: ── Install dependencies ──────────────────────────────────────────────────────
echo [>>] Installing build dependencies...
python -m pip install --quiet --upgrade ^
    pyinstaller ^
    flask ^
    requests ^
    Pillow ^
    urllib3 ^
    werkzeug

if errorlevel 1 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)
echo [OK] Dependencies ready.
echo.

:: ── Clean old build ───────────────────────────────────────────────────────────
echo [>>] Cleaning previous build...
if exist "%SCRIPT_DIR%\build" rd /s /q "%SCRIPT_DIR%\build"
if exist "%SCRIPT_DIR%\dist"  rd /s /q "%SCRIPT_DIR%\dist"
if exist "%SCRIPT_DIR%\xsiam_dashboard_win.spec" del "%SCRIPT_DIR%\xsiam_dashboard_win.spec"

:: ── Write PyInstaller spec ────────────────────────────────────────────────────
echo [>>] Generating PyInstaller spec...
(
echo # xsiam_dashboard_win.spec  ^(auto-generated^)
echo from PyInstaller.building.build_main import Analysis, PYZ, EXE, COLLECT
echo.
echo a = Analysis^(
echo     ['launcher.py'],
echo     pathex=['%SCRIPT_DIR:\=/%'],
echo     binaries=[],
echo     datas=[
echo         ^('config_manager.py', '.'^),
echo         ^('app.py', '.'^),
echo     ],
echo     hiddenimports=[
echo         'flask', 'flask.templating', 'flask.json', 'flask.logging',
echo         'werkzeug', 'werkzeug.serving', 'werkzeug.middleware.proxy_fix',
echo         'werkzeug.security',
echo         'requests', 'requests.adapters',
echo         'urllib3', 'urllib3.util',
echo         'json', 'threading', 'webbrowser', 'socket',
echo         'config_manager',
echo     ],
echo     hookspath=[],
echo     runtime_hooks=[],
echo     excludes=['tkinter','matplotlib','numpy','pandas','scipy'],
echo     noarchive=False,
echo ^)
echo.
echo pyz = PYZ^(a.pure, a.zipped_data^)
echo.
echo exe = EXE^(
echo     pyz,
echo     a.scripts,
echo     [],
echo     exclude_binaries=True,
echo     name='XSIAM Dashboard',
echo     debug=False,
echo     strip=False,
echo     upx=True,
echo     console=False,
echo     icon='%SCRIPT_DIR:\=/%/icon.ico',
echo     version_file=None,
echo ^)
echo.
echo coll = COLLECT^(
echo     exe,
echo     a.binaries,
echo     a.zipfiles,
echo     a.datas,
echo     strip=False,
echo     upx=True,
echo     name='XSIAM Dashboard',
echo ^)
) > "%SCRIPT_DIR%\xsiam_dashboard_win.spec"

:: ── Run PyInstaller ───────────────────────────────────────────────────────────
echo [>>] Running PyInstaller - please wait (3-5 minutes)...
echo.
python -m PyInstaller --noconfirm --log-level WARN "%SCRIPT_DIR%\xsiam_dashboard_win.spec"

if errorlevel 1 (
    echo.
    echo [ERROR] PyInstaller build failed. Check output above.
    pause
    exit /b 1
)

if not exist "%SCRIPT_DIR%\dist\XSIAM Dashboard\XSIAM Dashboard.exe" (
    echo [ERROR] Build output not found.
    pause
    exit /b 1
)
echo [OK] App bundle built.

:: ── Bundle admin credentials (end users skip setup page) ─────────────────────
set CONFIG_SRC=%APPDATA%\xsiam-dashboard\config.json
set CONFIG_DEST=%SCRIPT_DIR%\dist\XSIAM Dashboard\_default_config.json

if exist "%CONFIG_SRC%" (
    copy /Y "%CONFIG_SRC%" "%CONFIG_DEST%" >nul
    echo [OK] Credentials bundled - end users will skip the setup page.
    echo [WARN] Use a read-only Viewer API key. Do not distribute this installer publicly.
) else (
    echo [WARN] No saved credentials found at: %CONFIG_SRC%
    echo [WARN] End users WILL see the setup page on first launch.
    echo [WARN] To pre-configure: run  python launcher.py  first, complete setup,
    echo [WARN] then re-run this build script to bundle the credentials.
)

:: ── Try Inno Setup installer ──────────────────────────────────────────────────
set ISCC=""
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" set ISCC="C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if exist "C:\Program Files\Inno Setup 6\ISCC.exe"       set ISCC="C:\Program Files\Inno Setup 6\ISCC.exe"

if not %ISCC%=="" (
    echo [>>] Inno Setup found - building installer...
    %ISCC% "%SCRIPT_DIR%\installer_windows.iss"
    if errorlevel 1 (
        echo [WARN] Inno Setup failed - portable build still available.
    ) else (
        echo [OK] Installer created.
    )
) else (
    echo [INFO] Inno Setup not found - skipping installer creation.
    echo        Portable folder is ready to distribute.
    echo        Optional: Install Inno Setup 6 from https://jrsoftware.org/isdl.php
    echo        Then run this script again for a proper .exe installer.
)

:: ── Done ─────────────────────────────────────────────────────────────────────
echo.
echo ══════════════════════════════════════════════════════
echo   Build Complete!
echo ══════════════════════════════════════════════════════
echo.
echo   Portable app:  %SCRIPT_DIR%\dist\XSIAM Dashboard\
echo   Launch with:   dist\XSIAM Dashboard\XSIAM Dashboard.exe
echo.
if exist "%SCRIPT_DIR%\dist\XSIAM_Dashboard_Setup_%VERSION%.exe" (
    echo   Installer:     %SCRIPT_DIR%\dist\XSIAM_Dashboard_Setup_%VERSION%.exe
    echo.
)
echo   End users need nothing pre-installed.
echo   Browser opens automatically on launch.
echo.

:: Open the dist folder
explorer "%SCRIPT_DIR%\dist"

pause
