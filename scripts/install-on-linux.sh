#!/bin/bash
# AI 英语作文阅卷助手 · 安装到新电脑（Linux）
# 用法：把迁移包解压后运行本脚本。首次安装约 1-2 分钟。
set -e
PROJ="$HOME/essay-agent"
SRC="$(cd "$(dirname "$0")" && pwd)"

echo "▶ 检查 Node.js…"
if ! command -v node >/dev/null 2>&1; then
  echo "✗ 未安装 Node.js，请先安装："
  echo "  Debian/Ubuntu: sudo apt update && sudo apt install -y nodejs npm"
  echo "  Fedora/RHEL:   sudo dnf install -y nodejs npm"
  echo "  或从 https://nodejs.org 下载 LTS 版。装完再运行本脚本。"
  exit 1
fi
echo "✓ Node.js $(node --version)"

echo "▶ 复制程序到 $PROJ …"
if [ "$SRC" != "$PROJ" ]; then
  rm -rf "$PROJ"
  mkdir -p "$PROJ"
  cp -R "$SRC"/. "$PROJ"/
fi
cd "$PROJ"

echo "▶ 安装依赖（首次约 1-2 分钟）…"
npm install --no-audit --no-fund --cache "$PROJ/.npm-cache-local"

echo "▶ 创建桌面快捷方式…"
DESKTOP_DIR="$HOME/.local/share/applications"
mkdir -p "$DESKTOP_DIR" "$HOME/Desktop" 2>/dev/null || true
cat > "$DESKTOP_DIR/启动阅卷助手.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=启动阅卷助手
Comment=AI 英语作文阅卷助手
Exec=bash -c 'cd $HOME/essay-agent && bash scripts/启动阅卷助手-linux.sh; read -p \"按回车退出\"'
Terminal=true
Categories=Utility;
EOF
chmod +x "$DESKTOP_DIR/启动阅卷助手.desktop"
cp "$DESKTOP_DIR/启动阅卷助手.desktop" "$HOME/Desktop/启动阅卷助手.desktop" 2>/dev/null || true

echo ""
echo "✓ 安装完成！"
echo "  从应用菜单或桌面双击「启动阅卷助手」即可开始阅卷。"
echo "  注意：首次使用需要在专用浏览器里重新登录好分数平台。"
echo "  若没有 Chrome/Chromium/Edge 浏览器，请先安装其中一个。"
