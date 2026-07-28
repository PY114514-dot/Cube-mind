@echo off
chcp 65001 >nul
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel% equ 0 (
    py -3 start.py
) else (
    python start.py
)

if not %errorlevel% equ 0 pause
