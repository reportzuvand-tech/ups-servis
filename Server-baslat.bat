@echo off
title UPS Servis - LOKAL SERVER (pencereni baglamayin)
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js tapilmadi. Pulsuz yukleyin ve qurasdirin: https://nodejs.org  (LTS versiyasi^)
  echo  Ve ya bu emri isledin:  winget install OpenJS.NodeJS.LTS
  echo  Sonra bu fayli yeniden isledin.
  echo.
  pause
  exit /b
)
cd /d "%~dp0server"
node server.js
pause
