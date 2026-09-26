@echo off
chcp 65001 >nul
setlocal
set HERE=%~dp0
set CFGDIR=%APPDATA%\RustDesk\config
if not exist "%CFGDIR%" mkdir "%CFGDIR%"
taskkill /IM rustdesk.exe /F >nul 2>&1
if exist "%HERE%RustDesk2.toml" copy /Y "%HERE%RustDesk2.toml" "%CFGDIR%\RustDesk2.toml" >nul
start "" "%HERE%rustdesk.exe"
