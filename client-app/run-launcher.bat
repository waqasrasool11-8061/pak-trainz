@echo off
title TRS DEP PAK - Trainz Addons Launcher
cd /d "%~dp0"
echo ======================================================================
echo   TRS DEP PAK - Trainz Railroad Simulator Addons Launcher (Phase 3)
echo   Core Team: Waqas Rasool (Pindi) ^| Asif Khan (Karachi) ^| Usman Mani (Qatar)
echo ======================================================================
echo.

if not exist "node_modules\electron" (
    echo [*] First-time setup: Installing lightweight Electron runtime...
    call npm install electron --save-dev
)

echo [*] Launching Desktop Window...
npx electron .
pause
