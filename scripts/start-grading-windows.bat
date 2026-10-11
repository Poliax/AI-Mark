@echo off
chcp 65001 >nul
echo ==============================================
echo  AI 英语作文阅卷助手 - 一键启动（Windows）
echo  支持 Edge 或 Chrome（不支持火狐）
echo ==============================================
set PORT=9222
set PROJ=%USERPROFILE%\essay-agent

if not exist "%PROJ%\package.json" (
  echo [错误] 未找到程序目录 %PROJ%
  echo 请先运行迁移包里的 install-on-windows.bat
  pause
  exit /b 1
)
rem 包内自带 Node 运行时（发布包）时优先使用
if exist "%PROJ%\runtime\win-x64\node.exe" set "PATH=%PROJ%\runtime\win-x64;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。请先到 https://nodejs.org 下载 LTS 版安装。
  pause
  exit /b 1
)

rem 1. 检测专用浏览器是否已在运行
powershell -Command "try { (Invoke-WebRequest -Uri http://127.0.0.1:%PORT%/json/version -TimeoutSec 2 -UseBasicParsing).StatusCode } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 goto :already

rem 找 Edge 或 Chrome（按常见安装路径逐个尝试）
set "BROWSER="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%LocalAppData%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%LocalAppData%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if "%BROWSER%"=="" (
  echo [错误] 未找到 Edge 或 Chrome 浏览器，请先安装其中一个。
  pause
  exit /b 1
)
echo 正在启动专用浏览器…
start "" "%BROWSER%" --remote-debugging-port=%PORT% --user-data-dir="%USERPROFILE%\essay-agent-browser" https://yue.haofenshu.com/
echo 请在打开的浏览器窗口里登录好分数，并进入英语作文阅卷页面。
goto :waitpage

:already
echo 专用浏览器已在运行。

:waitpage
rem 2. 等待阅卷页面出现（最多 3 分钟，出现即继续）
echo 等待阅卷页面…
for /l %%i in (1,1,90) do (
  powershell -Command "try { $r = Invoke-WebRequest -Uri http://127.0.0.1:%PORT%/json -TimeoutSec 2 -UseBasicParsing; if ($r.Content -match 'yue.haofenshu.com.*mark') { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto :found
  timeout /t 2 /nobreak >nul
)
:found

rem 3. 停掉旧 Agent（避免端口冲突，保证用上最新版本）
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :8766 ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>nul

rem 4. 依赖缺失时自动补装（首次运行约 1-2 分钟）
if not exist "%PROJ%\node_modules" (
  echo 首次运行，正在安装依赖（约 1-2 分钟）…
  cd /d "%PROJ%"
  call npm install --no-audit --no-fund --cache "%PROJ%\.npm-cache-local" --registry=https://registry.npmmirror.com
)

rem 5. 启动 Agent（DRY RUN：只高亮建议分数，绝不点击）
cd /d "%PROJ%"
call npm run start
pause
