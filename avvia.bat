@echo off
title PartiAmo — Server Locale
echo ========================================================
echo   PartiAmo — Assistente di Viaggio
echo   Server locale in esecuzione su http://localhost:8000
echo ========================================================
echo.
start http://localhost:8000
python -m http.server 8000
