#!/bin/bash
# AI 英语作文阅卷助手 · 安装到新电脑（macOS）
# 用法：把迁移包解压后，双击本文件。首次安装约 1-2 分钟。
set -e
PROJ="$HOME/essay-agent"
SRC="$(cd "$(dirname "$0")" && pwd)"

echo "▶ 检查 Node.js…"
# 优先使用包内自带的 Node 运行时（发布包，免安装）；其次系统 Node；都没有则自动下载
RUNTIME=""
if [ "$(uname -m)" = "arm64" ] && [ -x "$SRC/runtime/darwin-arm64/bin/node" ]; then
  RUNTIME="$SRC/runtime/darwin-arm64"
elif [ -x "$SRC/runtime/darwin-x64/bin/node" ]; then
  RUNTIME="$SRC/runtime/darwin-x64"
fi
if [ -n "$RUNTIME" ]; then
  export PATH="$RUNTIME/bin:$PATH"
  echo "✓ 使用内置 Node $(node --version)（无需单独安装）"
elif command -v node >/dev/null 2>&1; then
  echo "✓ Node.js $(node --version)"
else
  echo "▶ 未检测到 Node.js，正在自动下载内置运行时（约 40MB，仅首次）…"
  if [ -x "$SRC/scripts/fetch-runtime.sh" ] && bash "$SRC/scripts/fetch-runtime.sh"; then
    if [ "$(uname -m)" = "arm64" ] && [ -x "$SRC/runtime/darwin-arm64/bin/node" ]; then
      RUNTIME="$SRC/runtime/darwin-arm64"
    elif [ -x "$SRC/runtime/darwin-x64/bin/node" ]; then
      RUNTIME="$SRC/runtime/darwin-x64"
    fi
    export PATH="$RUNTIME/bin:$PATH"
    echo "✓ 使用自动下载的 Node $(node --version)"
  else
    echo "✗ 自动下载失败。请手动安装 Node.js（https://nodejs.org LTS 版），装完再双击本文件。"
    open https://nodejs.org
    exit 1
  fi
fi

echo "▶ 复制程序到 $PROJ …"
if [ "$SRC" != "$PROJ" ]; then
  rm -rf "$PROJ"
  mkdir -p "$PROJ"
  cp -R "$SRC"/. "$PROJ"/
fi
cd "$PROJ"

echo "▶ 安装依赖（首次约 1-2 分钟）…"
npm install --no-audit --no-fund --cache --registry=https://registry.npmmirror.com "$PROJ/.npm-cache-local"

echo "▶ 创建桌面快捷方式…"
# ---- 生成桌面「应用」（.app，双击即用，无终端窗口）----
chmod +x "$PROJ/scripts/start-grading-mac.sh" 2>/dev/null || true
APP="$HOME/Desktop/启动阅卷助手.app"
rm -rf "$APP"
osacompile -o "$APP" -e "do shell script \"nohup '$PROJ/scripts/start-grading-mac.sh' >/dev/null 2>&1 &\"" 2>/dev/null || true
if [ -d "$APP" ]; then
  echo "✓ 已生成桌面应用：启动阅卷助手.app（双击即用，无终端窗口）"
else
  cp "$PROJ/scripts/start-grading-mac.sh" "$HOME/Desktop/启动阅卷助手.command"
  chmod +x "$HOME/Desktop/启动阅卷助手.command"
  echo "✓ 已生成桌面启动器：启动阅卷助手.command（首次需右键 → 打开）"
fi

echo ""
echo "✓ 安装完成！"
echo "  以后双击桌面「启动阅卷助手」即可开始阅卷。"
echo "  注意：第一次使用时需要在专用 Chrome 里重新登录好分数平台。"
echo "  若新电脑没有 Chrome 浏览器，请先安装 Google Chrome。"
