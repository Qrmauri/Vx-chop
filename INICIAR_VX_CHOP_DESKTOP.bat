@echo off
chcp 65001 > nul
title VX-CHOP MPC Desktop
echo ========================================================
echo       Iniciando VX-CHOP MPC (Aplicacion de Escritorio)...
echo ========================================================
echo.
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
echo [1/2] Compilando y ejecutando ventana de escritorio Tauri...
npm run tauri dev
pause
