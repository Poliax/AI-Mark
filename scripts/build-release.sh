#!/bin/bash
# 生成「零依赖发布包」：内置 Node 运行时，对方无需安装任何环境。
# 产出（项目 build/release/ 下）：
#   essay-agent-mac.zip      (内置 darwin-arm64 + darwin-x64 Node)
#   essay-agent-windows.zip  (内置 win-x64 Node)
# 发布包不带 API Key：新用户在面板「大模型设置」里填自己的智谱 Key 即可。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
V=v22.14.0
RUNTIME_DIR="build/runtime"

echo "▶ 准备 Node 运行时…"
mkdir -p "$RUNTIME_DIR"
for spec in "darwin-arm64:node-v22.14.0-darwin-arm64.tar.gz" "darwin-x64:node-v22.14.0-darwin-x64.tar.gz"; do
  name="${spec%%:*}"; file="${spec##*:}"
  if [ ! -f "$RUNTIME_DIR/$file" ]; then
    curl -sL -o "$RUNTIME_DIR/$file" "https://nodejs.org/dist/$V/$file"
  fi
  rm -rf "$RUNTIME_DIR/$name"
  mkdir -p "$RUNTIME_DIR/$name"
  tar -xzf "$RUNTIME_DIR/$file" -C "$RUNTIME_DIR/$name" --strip-components=1
done
if [ ! -f "$RUNTIME_DIR/node-win-x64.zip" ]; then
  curl -sL -o "$RUNTIME_DIR/node-win-x64.zip" "https://nodejs.org/dist/$V/node-v22.14.0-win-x64.zip"
fi
rm -rf "$RUNTIME_DIR/win-x64"
mkdir -p "$RUNTIME_DIR/win-x64"
unzip -q -o "$RUNTIME_DIR/node-win-x64.zip" -d "$RUNTIME_DIR/win-tmp"
cp -R "$RUNTIME_DIR"/win-tmp/node-*/ "$RUNTIME_DIR/win-x64/"
rm -rf "$RUNTIME_DIR/win-tmp"
echo "✓ 运行时就绪"

# 复制项目文件（排除重量/无关内容）
copy_project() {
  local out="$1"
  rm -rf "$out"
  mkdir -p "$out"
  tar -cf - \
    --exclude node_modules --exclude dist --exclude logs --exclude artifacts \
    --exclude build --exclude .npm-cache-local --exclude chrome-profile --exclude data --exclude runtime \
    --exclude '.git' --exclude '*.command' . | tar -xf - -C "$out"
  # 无 Key 的 .env：新用户在面板里填自己的 Key
  cat > "$out/.env" <<'ENVEOF'
# 智谱 AI 开放平台 API Key（https://open.bigmodel.cn/usercenter/apikeys 免费注册创建）
# 打开工具后也可在悬浮面板「大模型设置」里直接填写，无需编辑本文件。
ZHIPU_API_KEY=

AI_VISION_BASE_URL=https://open.bigmodel.cn/api/paas/v4
AI_VISION_MODEL=glm-4v-flash

AI_GRADING_BASE_URL=https://open.bigmodel.cn/api/paas/v4
AI_GRADING_MODEL=glm-4-flash
ENVEOF
}

echo "▶ 组装 macOS 发布包…"
copy_project "build/release/essay-agent-mac"
mkdir -p "build/release/essay-agent-mac/runtime"
cp -R "$RUNTIME_DIR/darwin-arm64" "build/release/essay-agent-mac/runtime/darwin-arm64"
cp -R "$RUNTIME_DIR/darwin-x64" "build/release/essay-agent-mac/runtime/darwin-x64"
cp scripts/install-on-new-mac.command "build/release/essay-agent-mac/install.command"
chmod +x "build/release/essay-agent-mac/install.command"
cat > "build/release/essay-agent-mac/README.txt" <<'EOF'
【安装步骤（macOS，免装任何环境）】
1. 双击本文件夹里的 install.command（首次需右键→打开）；
2. 等待 1-2 分钟自动安装，桌面出现「启动阅卷助手」；
3. 双击「启动阅卷助手」→ 专用 Chrome 打开好分数 → 登录后进入阅卷页；
4. 悬浮面板里「大模型设置」→ 粘贴自己的智谱 API Key（免费注册：open.bigmodel.cn）→ 保存；
5. 填评分标准 → 点「开始」。默认 DRY RUN：只高亮建议分数，绝不点击。
EOF

echo "▶ 组装 Windows 发布包…"
copy_project "build/release/essay-agent-windows"
mkdir -p "build/release/essay-agent-windows/runtime"
cp -R "$RUNTIME_DIR/win-x64" "build/release/essay-agent-windows/runtime/win-x64"
cp scripts/install-on-windows.bat "build/release/essay-agent-windows/install.bat"
cat > "build/release/essay-agent-windows/README.txt" <<'EOF'
【安装步骤（Windows 10/11，免装任何环境）】
1. 双击本文件夹里的 install.bat（若 Windows 提示拦截：右键 install.bat → 属性 → 勾选「解除锁定」→ 确定，再双击）；
2. 等待 1-2 分钟自动安装，桌面出现「启动阅卷助手.bat」；
3. 双击「启动阅卷助手」→ 专用 Edge/Chrome 打开好分数 → 登录后进入阅卷页；
4. 悬浮面板里「大模型设置」→ 粘贴自己的智谱 API Key（免费注册：open.bigmodel.cn）→ 保存；
5. 填评分标准 → 点「开始」。默认 DRY RUN：只高亮建议分数，绝不点击。
EOF

echo "▶ 打包 zip…"
cd build/release
rm -f essay-agent-mac.zip essay-agent-windows.zip
zip -rq essay-agent-mac.zip "essay-agent-mac"
zip -rq essay-agent-windows.zip "essay-agent-windows"
ls -la *.zip
echo "✓ 发布包已生成：build/release/essay-agent-mac.zip / essay-agent-windows.zip"
