@echo off
cd /d "%~dp0"
echo === TDEE Calculator - Git Push ===
echo.
git add .
set /p msg="Commit message: "
if "%msg%"=="" set msg=update %date% %time:~0,5%
git commit -m "%msg%"
git push origin main
echo.
echo Done! Press any key to close.
pause >nul