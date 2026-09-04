@echo off
rem ============================================================
rem  WindowPtero - bam phai file nay -> Run as administrator
rem  Script se tu cai Node.js, Java, panel va bat panel len.
rem ============================================================

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [LOI] Can quyen Administrator.
  echo   Bam phai file nay roi chon "Run as administrator".
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
