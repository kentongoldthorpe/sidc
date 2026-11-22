@echo off
rem Double-click to start the COA Builder server (Windows PowerShell, no install needed).
rem Extra arguments are passed on, e.g.  serve.cmd -Port 8081
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
