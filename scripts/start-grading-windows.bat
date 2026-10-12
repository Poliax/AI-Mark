@echo off
chcp 65001 >nul
setlocal
rem ------------------------------------------------------------------
rem Self-relaunch with full logging: every run writes a log on the
rem Desktop, and any failure pops up a message box (so a minimized
rem window can never hide the real error again).
rem ------------------------------------------------------------------
if /i "%~1"=="run" goto :main
set "LOGDIR=%USERPROFILE%\Desktop"
for /f "delims=" %%d in ('powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"') do set "LOGDIR=%%d"
set "LOG=%LOGDIR%\essay-agent-log.txt"
echo [%date% %time%] launcher start > "%LOG%"
cmd /c call "%~f0" run >> "%LOG%" 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; $p=Join-Path ([Environment]::GetFolderPath('Desktop')) 'essay-agent-log.txt'; [System.Windows.MessageBox]::Show('The assistant could not start.' + [Environment]::NewLine + [Environment]::NewLine + 'Please send this log file to your teacher:' + [Environment]::NewLine + $p, 'AI Essay Grading Assistant')" 2>nul
  exit /b 1
)
exit /b 0

:main
echo ==============================================
echo  AI Essay Grading Assistant - Launcher (Windows)
echo  Uses Edge or Chrome (Firefox is not supported)
echo ==============================================
set PORT=9222
set PROJ=%USERPROFILE%\essay-agent

if not exist "%PROJ%\package.json" (
  echo [ERROR] program folder not found: %PROJ%
  echo Please run install-on-windows.bat first.
  exit /b 1
)

rem Prefer bundled Node runtime
if exist "%PROJ%\runtime\win-x64\node.exe" set "PATH=%PROJ%\runtime\win-x64;%PATH%"
where node >nul 2>nul
if not errorlevel 1 goto :nodeok
echo No Node.js found. Downloading bundled runtime (about 30MB, first time only)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJ%\scripts\fetch-runtime.ps1"
if exist "%PROJ%\runtime\win-x64\node.exe" set "PATH=%PROJ%\runtime\win-x64;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] runtime download failed. Please install Node.js from https://nodejs.org
  exit /b 1
)
:nodeok
echo [OK] node: & node --version

rem 1. Find Edge or Chrome: usual folders first, then the registry (custom install locations)
rem    (browser detection must come first: it is also needed when a browser is already running)
set "BROWSER="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%LocalAppData%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%LocalAppData%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER for /f "tokens=2,*" %%a in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" /ve 2^>nul ^| findstr /i "REG_SZ"') do set "BROWSER=%%b"
if not defined BROWSER for /f "tokens=2,*" %%a in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul ^| findstr /i "REG_SZ"') do set "BROWSER=%%b"
if not defined BROWSER for /f "tokens=2,*" %%a in ('reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul ^| findstr /i "REG_SZ"') do set "BROWSER=%%b"
if not defined BROWSER (
  echo [ERROR] Edge or Chrome not found. Please install one of them first.
  exit /b 1
)
echo [OK] browser: %BROWSER%
set "PROFILE=%USERPROFILE%\essay-agent-chrome"

powershell -Command "try { (Invoke-WebRequest -Uri http://127.0.0.1:%PORT%/json/version -TimeoutSec 2 -UseBasicParsing).StatusCode } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 goto :already

echo Starting the dedicated browser ...
start "" "%BROWSER%" --remote-debugging-port=%PORT% --user-data-dir="%PROFILE%" https://yue.haofenshu.com/
echo Please log in to the marking platform in that window, then open an essay page.
goto :waitpage

:already
echo Dedicated browser is already running - opening the platform page.
start "" "%BROWSER%" --user-data-dir="%PROFILE%" https://yue.haofenshu.com/
goto :waitpage

:waitpage
rem 2. Wait for a platform page (max 1 minute)
echo Waiting for the platform page ...
for /l %%i in (1,1,30) do (
  powershell -Command "try { $r = Invoke-WebRequest -Uri http://127.0.0.1:%PORT%/json -TimeoutSec 2 -UseBasicParsing; if ($r.Content -match 'haofenshu.com') { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto :found
  timeout /t 2 /nobreak >nul
)
echo [WARN] no platform page detected yet - starting the agent anyway.

:found
rem 3. Stop an old agent instance (avoid port conflict, ensure latest build)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :8766 ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>nul

rem 4. Install dependencies if missing (first run: 1-2 minutes)
if not exist "%PROJ%\node_modules" (
  echo Installing dependencies (first time about 1-2 minutes) ...
  cd /d "%PROJ%"
  call npm install --no-audit --no-fund --cache "%PROJ%\.npm-cache-local" --registry=https://registry.npmmirror.com
)

rem 5. Start the agent (DRY RUN: only highlights the suggested score, never clicks)
cd /d "%PROJ%"
call npm run start
exit /b %errorlevel%
