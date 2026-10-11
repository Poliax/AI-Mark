#!/bin/bash
# 把项目推送到 GitHub（一次性配置 + 推送；令牌保存在本地 git 配置中，不会提交到仓库）
# 用法: bash scripts/git-push-github.sh <GitHub用户名> <令牌(ghp_开头)>
USER="$1"
TOKEN="$2"
if [ -z "$USER" ] || [ -z "$TOKEN" ]; then
  echo "用法: bash scripts/git-push-github.sh <GitHub用户名> <令牌>"
  exit 1
fi
cd "$(dirname "$0")/.." || exit 1
git remote remove origin 2>/dev/null || true
git remote add origin "https://${USER}:${TOKEN}@github.com/${USER}/essay-agent.git"
echo "▶ 推送到 github.com/${USER}/essay-agent …"
git push -u origin main
echo "✓ 完成。同事下载地址: https://github.com/${USER}/essay-agent"
