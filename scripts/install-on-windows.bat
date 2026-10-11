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

cd /d "%PROJ%"
echo 正在安装依赖（首次约 1-2 分钟）…
call npm install --no-audit --no-fund --cache "%PROJ%\.npm-cache-local"
if errorlevel 1 (
  echo [错误] 依赖安装失败，请检查网络后重试。
  pause
  exit /b 1
)

echo 正在创建桌面快捷方式…
copy /y "%~dp0scripts\启动阅卷助手-windows.bat" "%USERPROFILE%\Desktop\启动阅卷助手.bat" >nul

echo.
echo 安装完成！
echo 以后双击桌面「启动阅卷助手.bat」即可开始阅卷。
echo 注意：
echo  1. 使用 Edge 浏览器（不支持火狐）；专用 Edge 里需要重新登录好分数。
echo  2. 默认 DRY RUN（只高亮建议分数，绝不点击），安全。
pause
