@echo off
chcp 65001 >nul
echo ==============================================
echo  AI 英语作文阅卷助手 - 安装到新电脑（Windows）
echo  首次安装约 1-2 分钟
echo ==============================================

rem 优先使用包内自带的 Node 运行时（发布包，免安装）；否则用系统 Node
if exist "%~dp0runtime\win-x64\node.exe" (
  set "PATH=%~dp0runtime\win-x64;%PATH%"
  goto :nodeok
)
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。
  echo 请先到 https://nodejs.org 下载 LTS 版双击安装，装完再双击本文件。
  start https://nodejs.org
  pause
  exit /b 1
)
:nodeok
node --version

set PROJ=%USERPROFILE%\essay-agent
echo 正在复制程序到 %PROJ% ...
if exist "%PROJ%" rmdir /s /q "%PROJ%"
mkdir "%PROJ%"
xcopy /e /i /y "%~dp0." "%PROJ%" >nul

rem 自动识别真实桌面路径（兼容 OneDrive 重定向的桌面）
set "DESKTOP=%USERPROFILE%\Desktop"
for /f "delims=" %%d in ('powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"') do set "DESKTOP=%%d"

rem 先创建桌面快捷方式（即使依赖安装失败也有入口，启动器会自动补装）
echo 正在创建桌面快捷方式…
if not exist "%DESKTOP%" mkdir "%DESKTOP%"
copy /y "%~dp0scripts\启动阅卷助手-windows.bat" "%DESKTOP%\启动阅卷助手.bat" >nul
echo 桌面快捷方式已创建: %DESKTOP%\启动阅卷助手.bat

cd /d "%PROJ%"
echo 正在安装依赖（首次约 1-2 分钟）…
call npm install --no-audit --no-fund --cache "%PROJ%\.npm-cache-local" --registry=https://registry.npmmirror.com
if errorlevel 1 (
  echo [提示] 依赖安装未成功，稍后双击桌面「启动阅卷助手」会自动重试。
) else (
  echo 依赖安装完成。
)

echo.
echo 安装完成！
echo 以后双击桌面「启动阅卷助手.bat」即可开始阅卷。
echo 注意：
echo  1. 使用 Edge 或 Chrome 浏览器（不支持火狐）；专用浏览器里需要重新登录好分数。
echo  2. 默认 DRY RUN（只高亮建议分数，绝不点击），安全。
pause
