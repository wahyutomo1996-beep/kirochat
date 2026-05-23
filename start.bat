@echo off
title Prometheus Dev Server
echo.
echo  ========================================
echo   Prometheus - Multi-Provider AI Gateway
echo  ========================================
echo.
echo  Cleaning cache...
if exist ".next" rmdir /s /q ".next"
echo.
echo  Starting dev server...
echo  URL: http://localhost:3000
echo  Login: admin@prometheus.local / admin123
echo.
echo  Press Ctrl+C to stop
echo  ========================================
echo.
cd /d "%~dp0"
node node_modules\next\dist\bin\next dev --port 3000
