#!/bin/bash
# AI 英语作文阅卷助手 · 安装到新电脑（macOS）
# 用法：把迁移包解压后，双击本文件。首次安装约 1-2 分钟。
set -e
PROJ="$HOME/essay-agent"
SRC="$(cd "$(dirname "$0")" && pwd)"

echo "▶ 检查 Node.js…"
# 优先使用包内自带的 Node 运行时（发布包，免安装）；否则用系统 Node
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
  echo "✗ 未安装 Node.js。正在打开下载页，请下载 LTS 版双击安装，装完再双击本文件。"
  open https://nodejs.org
  exit 1
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
cat > "$HOME/Desktop/启动阅卷助手.command" <<'LAUNCHER'
#!/bin/bash
# AI 英语作文阅卷助手 · 一键启动（macOS）
PORT=9222
if [ -f "$HOME/essay-agent/package.json" ]; then
  PROJ="$HOME/essay-agent"
elif [ -f "$HOME/Documents/Harness/tests/essay-agent/package.json" ]; then
  PROJ="$HOME/Documents/Harness/tests/essay-agent"
else
  echo "✗ 未找到程序目录。请先运行迁移包里的「安装到新电脑.command」。"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "✗ 未检测到 Node.js。请先安装：https://nodejs.org （下载 LTS 版双击安装）"
  exit 1
fi

# 包内自带 Node 运行时（发布包）时优先使用
if [ "$(uname -m)" = "arm64" ] && [ -x "$PROJ/runtime/darwin-arm64/bin/node" ]; then
  export PATH="$PROJ/runtime/darwin-arm64/bin:$PATH"
elif [ -x "$PROJ/runtime/darwin-x64/bin/node" ]; then
  export PATH="$PROJ/runtime/darwin-x64/bin:$PATH"
fi

if ! curl -s -m 2 http://127.0.0.1:$PORT/json/version >/dev/null 2>&1; then
  echo "▶ 正在启动专用 Chrome…"
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --remote-debugging-port=$PORT --user-data-dir="$HOME/essay-agent-chrome" \
    "https://yue.haofenshu.com/" >/dev/null 2>&1 &
  for i in $(seq 1 30); do
    curl -s -m 2 http://127.0.0.1:$PORT/json/version >/dev/null 2>&1 && break
    sleep 1
  done
  echo "✓ Chrome 已启动。请在打开的窗口里登录好分数，并进入英语作文阅卷页面。"
else
  echo "✓ 专用 Chrome 已在运行。"
fi

echo "⏳ 等待阅卷页面…"
for i in $(seq 1 90); do
  if curl -s -m 2 http://127.0.0.1:$PORT/json 2>/dev/null | grep -q 'yue.haofenshu.com.*mark'; then
    echo "✓ 检测到阅卷页面"
    break
  fi
  sleep 2
done

if lsof -ti :8766 >/dev/null 2>&1; then
  echo "▶ 检测到旧 Agent 仍在运行，自动停掉…"
  kill $(lsof -ti :8766) 2>/dev/null
  sleep 1
fi

cd "$PROJ"
npm run start
LAUNCHER
chmod +x "$HOME/Desktop/启动阅卷助手.command"

echo ""
echo "✓ 安装完成！"
echo "  以后双击桌面「启动阅卷助手」即可开始阅卷。"
echo "  注意：第一次使用时需要在专用 Chrome 里重新登录好分数平台。"
echo "  若新电脑没有 Chrome 浏览器，请先安装 Google Chrome。"
