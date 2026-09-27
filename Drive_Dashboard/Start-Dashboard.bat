@echo off
rem Opens the Drive Dashboard for this drive in your default browser.
start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0server.ps1"
