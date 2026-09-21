@echo off
chcp 65001 > nul
title VX-CHOP MPC Sampler
echo ========================================================
echo       Iniciando VX-CHOP MPC Sampler...
echo ========================================================
echo.
cd /d "%~dp0"

echo [1/2] Abriendo el navegador en http://localhost:4173 ...
start http://localhost:4173

echo [2/2] Iniciando servidor local...
python server.py 4173
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [Aviso] Python no inicio server.py, intentando con Vite preview...
  npm run preview
)
pause

