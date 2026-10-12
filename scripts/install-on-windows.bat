@echo off
chcp 65001 >nul
setlocal
echo ==============================================
echo  AI Essay Grading Assistant - Windows Installer
echo  (first install takes about 1-2 minutes)
echo ==============================================

rem Detect the real Desktop folder (works with OneDrive-redirected Desktop)
set "DESKTOP=%USERPROFILE%\Desktop"
for /f "delims=" %%d in ('powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"') do set "DESKTOP=%%d"
set "LOG=%DESKTOP%\essay-agent-install-log.txt"
echo [%date% %time%] install started > "%LOG%"

rem Prefer bundled Node runtime, then system Node, otherwise download it
if exist "%~dp0runtime\win-x64\node.exe" (
  set "PATH=%~dp0runtime\win-x64;%PATH%"
  echo [OK] using bundled Node
  echo [OK] using bundled Node >> "%LOG%"
  goto :nodeok
)
where node >nul 2>nul
if not errorlevel 1 goto :nodeok

echo No Node.js found. Downloading bundled runtime (about 30MB)...
echo [DL] fetching node runtime >> "%LOG%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\fetch-runtime.ps1"
if exist "%~dp0runtime\win-x64\node.exe" (
  set "PATH=%~dp0runtime\win-x64;%PATH%"
  echo [OK] runtime downloaded
  goto :nodeok
)
echo [ERROR] runtime download failed. Please install Node.js from https://nodejs.org then run this file again.
echo [ERROR] runtime download failed >> "%LOG%"
start https://nodejs.org
pause
exit /b 1

:nodeok
node --version >> "%LOG%" 2>&1

set PROJ=%USERPROFILE%\essay-agent
echo Copying program to %PROJ% ...
if exist "%PROJ%" rmdir /s /q "%PROJ%"
mkdir "%PROJ%"
xcopy /e /i /y "%~dp0." "%PROJ%" >nul
echo [OK] program copied >> "%LOG%"

echo Creating desktop shortcut ...
if not exist "%DESKTOP%" mkdir "%DESKTOP%"
rem Proper Windows shortcut (.lnk) running minimized: no black console window
rem Shortcut display names are built from Unicode code points so this file stays pure ASCII
powershell -NoProfile -Command "$cs=0x542F,0x52A8,0x9605,0x5377,0x52A9,0x624B; $n=($cs | ForEach-Object {[char]$_}) -join ''; $ws=New-Object -ComObject WScript.Shell; $l=$ws.CreateShortcut((Join-Path '%DESKTOP%' ($n + '.lnk'))); $l.TargetPath='%~dp0scripts\start-grading-windows.bat'; $l.WorkingDirectory='%~dp0scripts'; $l.WindowStyle=7; $l.IconLocation='%SystemRoot%\System32\shell32.dll,137'; $l.Description='AI Essay Grading Assistant'; $l.Save()" >nul 2>nul
echo [OK] desktop shortcut created >> "%LOG%"

rem Keep a launcher copy next to install.bat as well
copy /y "%~dp0scripts\start-grading-windows.bat" "%~dp0start-grading-windows.bat" >nul
echo [OK] local launcher copy created >> "%LOG%"

cd /d "%PROJ%"
echo Installing dependencies (first time about 1-2 minutes) ...
call npm install --no-audit --no-fund --cache "%PROJ%\.npm-cache-local" --registry=https://registry.npmmirror.com >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [WARN] dependency install failed; the launcher will retry automatically.
  echo [WARN] dependency install failed >> "%LOG%"
) else (
  echo [OK] dependencies installed
  echo [OK] dependencies installed >> "%LOG%"
)

echo.
echo Installation finished.
echo   - Desktop shortcut: start-grading-windows.bat (and a Chinese-named copy)
echo   - Launcher copy in this folder: start-grading-windows.bat
echo   - Install log: %LOG%
echo [OK] install finished >> "%LOG%"
pause
