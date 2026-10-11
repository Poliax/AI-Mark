#!/bin/bash
# 打包迁移包：把项目（不含依赖/日志）压成 zip，拷到新电脑解压后运行「安装到新电脑.command」
cd "$(dirname "$0")/.."
OUT="$HOME/Desktop/essay-agent-迁移包.zip"
rm -f "$OUT"
zip -r "$OUT" . \
  -x 'node_modules/*' \
  -x 'dist/*' \
  -x 'logs/*' \
  -x 'artifacts/*' \
  -x '.npm-cache-local/*' \
  -x 'chrome-profile/*' \
  -x '.git/*' \
  -x '*.command' >/dev/null
# 安装脚本单独放进包里（放在包内根目录）
zip -j "$OUT" scripts/install-on-new-mac.command >/dev/null
echo "✓ 迁移包已生成: $OUT"
echo "  注意：包内含 .env（你的智谱 API Key），只拷给自己的电脑，不要外传。"
