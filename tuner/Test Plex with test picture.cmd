@echo off
title Tohyee TV Tuner (test picture)
"%~dp0node.exe" "%~dp0app\src\main.js" --test-pattern %*
echo.
echo Tohyee TV Tuner has stopped. Press any key to close this window.
pause >nul
