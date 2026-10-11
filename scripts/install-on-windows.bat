@echo off
chcp 65001 >nul
echo ==============================================
echo  AI 英语作文阅卷助手 - 安装到新电脑（Windows）
echo  首次安装约 1-2 分钟
echo ==============================================

rem 自动识别真实桌面路径（兼容 OneDrive 重定向的桌面）
set "DESKTOP=%USERPROFILE%\Desktop"
for /f "delims=" %%d in ('powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"') do set "DESKTOP=%%d"
set "LOG=%DESKTOP%\essay-agent-安装日志.txt"
echo [%date% %time%] 开始安装 > "%LOG%"

rem 优先使用包内自带的 Node 运行时（发布包，免安装）；否则用系统 Node
if exist "%~dp0runtime\win-x64\node.exe" (
  set "PATH=%~dp0runtime\win-x64;%PATH%"
  echo [OK] 使用内置 Node >> "%LOG%"
  goto :nodeok
)
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。请先到 https://nodejs.org 下载 LTS 版双击安装，装完再双击本文件。
  echo [错误] 未检测到 Node.js >> "%LOG%"
  start https://nodejs.org
  pause
  exit /b 1
)
:nodeok
node --version >> "%LOG%" 2>&1

set PROJ=%USERPROFILE%\essay-agent
echo 正在复制程序到 %PROJ% ...
if exist "%PROJ%" rmdir /s /q "%PROJ%"
mkdir "%PROJ%"
xcopy /e /i /y "%~dp0." "%PROJ%" >nul
echo [OK] 程序已复制到 %PROJ% >> "%LOG%"

rem 先创建桌面快捷方式（装依赖前就有入口）
echo 正在创建桌面快捷方式…
if not exist "%DESKTOP%" mkdir "%DESKTOP%"
copy /y "%~dp0scripts\启动阅卷助手-windows.bat" "%DESKTOP%\启动阅卷助手.bat" >nul
echo [OK] 桌面快捷方式已创建: %DESKTOP%\启动阅卷助手.bat >> "%LOG%"

rem 同时在本文件夹也放一份启动器（桌面找不到时直接用）
copy /y "%~dp0scripts\启动阅卷助手-windows.bat" "%~dp0启动阅卷助手.bat" >nul
echo [OK] 本文件夹也有「启动阅卷助手.bat」可双击 >> "%LOG%"

cd /d "%PROJ%"
echo 正在安装依赖（首次约 1-2 分钟）…
call npm install --no-audit --no-fund --cache "%PROJ%\.npm-cache-local" --registry=https://registry.npmmirror.com >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [提示] 依赖安装未成功，稍后双击「启动阅卷助手」会自动重试。
  echo [提示] 依赖安装未成功，双击启动器会自动重试 >> "%LOG%"
) else (
  echo 依赖安装完成。
  echo [OK] 依赖安装完成 >> "%LOG%"
)

echo.
echo 安装完成！
echo 桌面（%DESKTOP%）应有「启动阅卷助手.bat」。
echo 若桌面没有，本文件夹里也有一份，双击即可。
echo 安装日志: %LOG%
echo [完成] 安装流程结束 >> "%LOG%"
pause
