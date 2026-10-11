#!/bin/bash
# 自动下载 Node 运行时到 runtime/<平台>（macOS / Linux），免手动安装 Node
set -e
cd "$(dirname "$0")/.." || exit 1
V=v22.14.0
OS="$(uname -s)"
ARCH="$(uname -m)"
if [ "$OS" = "Darwin" ]; then
  if [ "$ARCH" = "arm64" ]; then DIR=darwin-arm64; FILE=node-$V-darwin-arm64.tar.gz
  else DIR=darwin-x64; FILE=node-$V-darwin-x64.tar.gz; fi
elif [ "$OS" = "Linux" ]; then
  if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then DIR=linux-arm64; FILE=node-$V-linux-arm64.tar.gz
  else DIR=linux-x64; FILE=node-$V-linux-x64.tar.gz; fi
else
  echo "✗ 暂不支持的系统: $OS（请手动安装 Node.js：https://nodejs.org）"
  exit 1
fi

if [ -x "runtime/$DIR/bin/node" ]; then
  echo "✓ 已内置 Node 运行时（runtime/$DIR）"
  exit 0
fi

echo "▶ 正在下载 Node 运行时（约 40MB，仅首次）…"
mkdir -p runtime
TMP="$(mktemp -d)"
OK=0
for BASE in "https://registry.npmmirror.com/-/binary/node/$V" "https://nodejs.org/dist/$V"; do
  echo "  源: $BASE"
  if curl -sL -o "$TMP/$FILE" "$BASE/$FILE" && [ -s "$TMP/$FILE" ]; then OK=1; break; fi
done
if [ "$OK" != "1" ]; then echo "✗ 下载失败，请检查网络后重试"; rm -rf "$TMP"; exit 1; fi

echo "▶ 解压…"
mkdir -p "runtime/$DIR"
tar -xzf "$TMP/$FILE" -C "runtime/$DIR" --strip-components=1
rm -rf "$TMP"
echo "✓ Node 运行时就绪: runtime/$DIR/bin/node"
