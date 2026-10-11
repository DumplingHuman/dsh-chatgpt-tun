#!/usr/bin/env bash
# 一键复现:DSH(0.1.1-rc.2) + @beforewave/dsh-with-chatgpt + Agent Helm 沙箱修复
#
# 用法:
#   ./setup.sh                 # 用默认路径 ~/dsh-official
#   DSH_DIR=/path/to/dsh ./setup.sh
#
# 幂等,可重复执行。需要: node >=22.19 / pnpm / git / python3。
set -euo pipefail

DSH_DIR="${DSH_DIR:-$HOME/dsh-official}"
DSH_TAG="dsh-v0.1.1-rc.2"
PLUGIN_VER="0.1.4"
WORKSPACE="${WORKSPACE:-$HOME}"          # 想让 Agent Helm 读写的目录
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo -e "\n==> $*"; }

# ---------------------------------------------------------------- 1. dsh 源码
log "1/6 准备 DSH 源码 ($DSH_TAG)"
if [ -d "$DSH_DIR/.git" ]; then
  git -C "$DSH_DIR" fetch --tags --quiet || true
  git -C "$DSH_DIR" checkout "$DSH_TAG"
else
  git clone https://github.com/deepseek-ai/deepseek-harness.git "$DSH_DIR"
  git -C "$DSH_DIR" checkout "$DSH_TAG"
fi

log "2/6 pnpm install && build"
(cd "$DSH_DIR" && pnpm install && pnpm run build)

# ---------------------------------------------------------------- 2. 插件
log "3/6 安装插件 @beforewave/dsh-with-chatgpt@$PLUGIN_VER 到 web profile"
(cd "$DSH_DIR" && pnpm dsh plugin --profile web add "@beforewave/dsh-with-chatgpt@$PLUGIN_VER")

# ---------------------------------------------------------------- 3. 沙箱补丁
log "4/6 应用 Agent Helm / sandbox-runtime 沙箱补丁"
bash "$HERE/patch-agenthelm-sandbox.sh"

# ---------------------------------------------------------------- 4. Agent Helm 配置
log "5/6 写 Agent Helm 配置 (~/.config/agent-helm/config.yml)"
mkdir -p "$HOME/.config/agent-helm"
cat > "$HOME/.config/agent-helm/config.yml" <<EOF
execution:
  allowUnsandboxed: true
  filesystem:
    allow:
      - $HOME/.ssh
    readOnly:
      - $DSH_DIR/profiles/web/node_modules/@anthropic-ai/sandbox-runtime
workspaces:
  - title: $(basename "$WORKSPACE")
    path: $WORKSPACE
    semantic:
      languages: [javascript, typescript]
EOF

# ---------------------------------------------------------------- 5. systemd(可选)
if command -v systemctl >/dev/null 2>&1; then
  log "6/6 安装 systemd user 服务(agent-helm-daemon + 自动打补丁)"
  mkdir -p "$HOME/.config/systemd/user"
  install -m 644 "$HERE/wait-agent-helm.sh" "$HOME/wait-agent-helm.sh"
  install -m 755 "$HERE/patch-agenthelm-sandbox.sh" "$HOME/patch-agenthelm-sandbox.sh"
  sed "s#/home/zpl#$HOME#g" "$HERE/systemd/agent-helm-daemon.service" \
    > "$HOME/.config/systemd/user/agent-helm-daemon.service"
  systemctl --user daemon-reload
  systemctl --user enable --now agent-helm-daemon
else
  log "6/6 无 systemd,跳过(可手动运行 daemon 并先执行 patch-agenthelm-sandbox.sh)"
fi

cat <<EOF

完成。启动 DSH:

  cd $DSH_DIR && DSH_HOME=~/.dsh-plugin pnpm dsh web --port 4001

然后在 ChatGPT 里建自定义连接器(Tunnel)指向你的隧道即可。
详见 README.md / VERSIONS.md。
EOF
