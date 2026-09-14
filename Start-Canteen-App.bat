@echo off
title Canteen App Server
cd /d "%~dp0"

echo ================================================
echo   CANTEEN APP - starting server, please wait...
echo   (Browser will open automatically in a moment)
echo   Close this window to STOP the app.
echo ================================================

REM Open the admin dashboard in the default browser after the server boots
start "" /b cmd /c "timeout /t 8 /nobreak >nul && start http://localhost:5173/admin"

REM Run the dev server (this window must stay open while using the app)
npm run dev

pause
