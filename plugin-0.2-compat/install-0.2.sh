#!/usr/bin/env bash
# 把 @beforewave/dsh-with-chatgpt 适配版装进一个 dsh 0.2.x 实例。
#
# 用法:
#   ./install-0.2.sh [--from-source] [<dsh仓库目录>]
#
#   默认: 用同目录下编好的 tgz 直接安装。
#   --from-source: clone 上游 v0.1.4 -> 打补丁 -> npm install -> build -> 安装。
#
# 幂等,可重复执行。需要: node>=22 / pnpm / git。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH="$HERE/dsh-0.2-compat.patch"
TGZ="$(ls "$HERE"/*.tgz 2>/dev/null | head -1 || true)"
UPSTREAM="https://github.com/BeforeWave/dsh-with-chatgpt.git"
SRC_DIR="${SRC_DIR:-$HOME/plugin-src/dsh-with-chatgpt}"

FROM_SOURCE=0
if [ "${1:-}" = "--from-source" ]; then FROM_SOURCE=1; shift; fi
DSH_DIR="${1:-$(pwd)}"

log() { echo -e "\n==> $*"; }

if [ "$FROM_SOURCE" = 1 ]; then
  log "从源码构建"
  if [ ! -d "$SRC_DIR/.git" ]; then
    git clone --branch v0.1.4 --depth 1 "$UPSTREAM" "$SRC_DIR"
  fi
  cd "$SRC_DIR"
  if git apply --check "$PATCH" 2>/dev/null; then git apply "$PATCH"; else
    echo "补丁已打过或无法应用,继续"; fi
  npm install --no-audit --no-fund --legacy-peer-deps
  npm run build
  TARGET="$SRC_DIR"
else
  log "使用预编译包"
  [ -n "$TGZ" ] || { echo "找不到 tgz,请加 --from-source 或手动指定" >&2; exit 1; }
  TARGET="$TGZ"
fi

log "安装到 dsh profile: $DSH_DIR (target=$TARGET)"
cd "$DSH_DIR"
pnpm dsh plugin --profile web add "$TARGET"

cat <<EOF

完成。重启 dsh web 生效:

  cd $DSH_DIR && pnpm dsh web --port 4001

如果日志里有 "adapter dsh is already registered with Core", 在
$DSH_DIR/profiles/web/cordis.patch.yml 里加:

  - id: dsh-with-chatgpt
    config:
      adapterId: dsh02
EOF
