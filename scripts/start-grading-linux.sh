#!/bin/bash
# AI 英语作文阅卷助手 · 一键启动（Linux）
# 支持 Chrome / Chromium / Edge（不支持火狐）
set -u
PORT=9222
PROJ="$HOME/essay-agent"

if [ ! -f "$PROJ/package.json" ]; then
  echo "✗ 未找到程序目录 $PROJ"
  echo "  请先运行迁移包里的 install-on-linux.sh"
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "✗ 未检测到 Node.js。Debian/Ubuntu: sudo apt install -y nodejs npm"
  echo "  Fedora/RHEL: sudo dnf install -y nodejs npm"
  exit 1
fi

# 1. 专用浏览器（未运行才启动）
if ! curl -s -m 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  BROWSER=""
  for cand in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge microsoft-edge-stable; do
    if command -v "$cand" >/dev/null 2>&1; then BROWSER="$(command -v "$cand")"; break; fi
  done
  if [ -z "$BROWSER" ]; then
    echo "✗ 未找到 Chrome/Chromium/Edge 浏览器，请先安装其中一个。"
    exit 1
  fi
  echo "▶ 正在启动专用浏览器…"
  nohup "$BROWSER" --remote-debugging-port=$PORT --user-data-dir="$HOME/essay-agent-browser" \
    --no-first-run "https://yue.haofenshu.com/" >/dev/null 2>&1 &
  for i in $(seq 1 30); do
    curl -s -m 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && break
    sleep 1
  done
  echo "✓ 浏览器已启动。请在打开的窗口里登录好分数，并进入英语作文阅卷页面。"
else
  echo "✓ 专用浏览器已在运行。"
fi

# 2. 等待阅卷页面（最多 3 分钟）
echo "⏳ 等待阅卷页面…"
for i in $(seq 1 90); do
  if curl -s -m 2 "http://127.0.0.1:$PORT/json" 2>/dev/null | grep -q 'yue.haofenshu.com.*mark'; then
    echo "✓ 检测到阅卷页面"
    break
  fi
  sleep 2
done

# 3. 停掉旧 Agent（避免端口冲突）
if command -v lsof >/dev/null 2>&1; then
  PID=$(lsof -ti :8766 2>/dev/null || true)
  [ -n "$PID" ] && kill $PID 2>/dev/null
else
  PID=$(ss -ltnp 2>/dev/null | grep ':8766' | grep -oP 'pid=\K[0-9]+' | head -1 || true)
  [ -n "$PID" ] && kill "$PID" 2>/dev/null
fi
sleep 1

# 4. 启动 Agent（DRY RUN：只高亮建议分数，绝不点击）
cd "$PROJ"
npm run start
