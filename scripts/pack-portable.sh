#!/bin/bash
# 打包迁移包：把项目（不含依赖/日志/数据）压成 zip，拷到新电脑解压后运行「安装到新电脑.command」
# 说明：迁移包内含 .env（你的 API Key），仅供自己换电脑使用，请勿外传。
cd "$(dirname "$0")/.." || exit 1
OUT="build/essay-agent-迁移包.zip"
mkdir -p build
TMP_CFG="$(mktemp)"
HAS_CFG=0

# 消毒：config.local.json 里的 ai.apiKey 不进包（避免 Key 混在平台配置里被误传）
if [ -f config.local.json ]; then
  HAS_CFG=1
  cp config.local.json "$TMP_CFG"
  python3 - <<'PY'
import json, os
p = 'config.local.json'
try:
    d = json.load(open(p, encoding='utf-8'))
    if isinstance(d.get('ai'), dict):
        for k in ('vision', 'grading'):
            if isinstance(d['ai'].get(k), dict):
                d['ai'][k]['apiKey'] = ''
    json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
except Exception as e:
    print('  警告：config.local.json 消毒失败:', e)
PY
fi

rm -f "$OUT"
zip -r "$OUT" . \
  -x 'node_modules/*' \
  -x 'dist/*' \
  -x 'logs/*' \
  -x 'artifacts/*' \
  -x 'data/*' \
  -x 'build/*' \
  -x '.npm-cache-local/*' \
  -x 'chrome-profile/*' \
  -x '.git/*' \
  -x '*.command' \
  -x 'essay-agent-*.zip' >/dev/null

# 还原本机配置
if [ "$HAS_CFG" = "1" ]; then cp "$TMP_CFG" config.local.json; fi
rm -f "$TMP_CFG"

# 安装脚本单独放进包里（放在包内根目录）
zip -j "$OUT" scripts/install-on-new-mac.command >/dev/null
# 复制到桌面（沙箱/权限不允许时给出路径提示）
if cp "$OUT" "$HOME/Desktop/essay-agent-迁移包.zip" 2>/dev/null; then
  echo "✓ 迁移包已生成并放到桌面: $HOME/Desktop/essay-agent-迁移包.zip"
else
  echo "✓ 迁移包已生成: $(pwd)/$OUT（请手动复制到桌面）"
fi
echo "  包内 config.local.json 的 API Key 已清空；.env 仍含你的 Key —— 只拷给自己的电脑，不要外传。"
