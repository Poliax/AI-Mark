#!/bin/bash
# AI 英语作文阅卷助手 · 一键启动（macOS）
# 作用：启动专用 Chrome/Edge（调试端口）→ 等待阅卷页 → 停掉旧 Agent → 启动 Agent
set -e
PORT=9222
# 程序目录：优先 ~/essay-agent（安装版），否则用本脚本所在仓库（开发版）
if [ -f "$HOME/essay-agent/package.json" ]; then
  PROJ="$HOME/essay-agent"
else
  PROJ="$(cd "$(dirname "$0")/.." && pwd)"
fi
LOG="$HOME/essay-agent-launch.log"

exec >> "$LOG" 2>&1
echo "==== $(date '+%F %T') 启动 ===="

if [ ! -f "$PROJ/package.json" ]; then
  osascript -e 'display alert "未找到程序目录" message "请先运行安装脚本 install-on-new-mac.command"' 2>/dev/null || true
  exit 1
fi

# 使用包内自带 Node 运行时（发布包）
if [ -x "$PROJ/runtime/darwin-arm64/bin/node" ]; then
  export PATH="$PROJ/runtime/darwin-arm64/bin:$PATH"
elif [ -x "$PROJ/runtime/darwin-x64/bin/node" ]; then
  export PATH="$PROJ/runtime/darwin-x64/bin:$PATH"
fi

cd "$PROJ"

# 1. 找浏览器（专用配置目录，独立于日常浏览器）
BROWSER=""
for cand in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
  if [ -x "$cand" ]; then BROWSER="$cand"; break; fi
done
if [ -z "$BROWSER" ]; then
  osascript -e 'display alert "未找到 Chrome 或 Edge" message "请先安装 Google Chrome 或 Microsoft Edge（不支持火狐）"' 2>/dev/null || true
  exit 1
fi

# 2. 专用浏览器未运行则启动（已运行则复用）
if ! curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "启动专用浏览器: $BROWSER"
  "$BROWSER" --remote-debugging-port=$PORT \
    --user-data-dir="$HOME/essay-agent-browser" \
    "https://yue.haofenshu.com/" >/dev/null 2>&1 &
  sleep 3
fi

# 3. 等待出现平台页面（最多 60 秒，出现即继续）
for _ in $(seq 1 30); do
  if curl -s --max-time 2 "http://127.0.0.1:$PORT/json" 2>/dev/null | grep -q "haofenshu.com"; then break; fi
  sleep 2
done

# 4. 停掉旧 Agent（避免端口冲突，并确保用上最新代码）
OLD=$(lsof -ti :8766 2>/dev/null || true)
if [ -n "$OLD" ]; then kill $OLD 2>/dev/null || true; sleep 1; fi

# 5. 依赖缺失时自动补装
if [ ! -d "$PROJ/node_modules" ]; then
  echo "首次运行：安装依赖…"
  npm install --no-audit --no-fund --cache "$PROJ/.npm-cache-local" --registry=https://registry.npmmirror.com || true
fi

# 6. 启动 Agent（DRY RUN：只高亮建议分数，绝不点击平台按钮）
echo "启动 Agent…"
npm run start
