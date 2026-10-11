#!/usr/bin/env bash
# 让 Agent Helm 的命令沙箱在 Linux/WSL2 上可用,并且允许 SSH/出网。
# 幂等:可重复执行。挂在 agent-helm-daemon.service 的 ExecStartPre,
# 这样即使 pnpm install 覆盖 node_modules,下次启动也会自动重打。
set -u

RM=/home/zpl/.dsh-plugin/profiles/web/node_modules
AH="$RM/@beforewave/agent-helm/lib/execution-worker.js"
LX="$RM/@anthropic-ai/sandbox-runtime/dist/sandbox/linux-sandbox-utils.js"

log() { echo "[patch-agenthelm-sandbox] $*"; }

[ -f "$AH" ] && [ -f "$LX" ] || { log "target files not found"; exit 0; }

python3 - "$AH" "$LX" <<'PY'
import sys
ah, lx = sys.argv[1], sys.argv[2]
w = open(ah).read()
changed = []

# ---- A) Agent Helm: Linux 下 Rt() 不做 macOS glob 转义 ----
# 原实现把 allowRead 路径编码成 Seatbelt glob class(/bin/bash -> /bin/[b]ash),
# 遇到真实存在的 /bin/[ 会抛 sandbox_policy_unsupported。Linux 用字面路径即可。
a = 'function Rt(t){let i=_t(t);if(/[*?\\[\\]]/.test(i))'
b = 'function Rt(t){let i=_t(t);if(process.platform!=="darwin")return i;if(/[*?\\[\\]]/.test(i))'
if a in w:
    w = w.replace(a, b, 1); changed.append("A:Rt-linux")

# ---- B) Agent Helm: 清空沙箱 read deny(允许读 /etc、~/.ssh 等) ----
a2 = 'denyRead:[...t.readDeniedPaths,...t.deniedPaths,...t.protectedReadPaths??[]]'
if a2 in w:
    w = w.replace(a2, 'denyRead:[]', 1); changed.append("B:no-denyRead")

# ---- C) Agent Helm: 清空沙箱 write deny ----
a3 = 'denyWrite:[...t.deniedPaths,...t.writeDeniedPaths,...t.protectedWritePaths,...Sr(t.writablePaths)]'
if a3 in w:
    w = w.replace(a3, 'denyWrite:[]', 1); changed.append("C:no-denyWrite")

# ---- F) Agent Helm: 沙箱内用真实 HOME/USER(让 ssh 能读 ~/.ssh) ----
a5 = 'let s={...t.environment};for(let A of["SRT_PROXY_PORT"'
b5 = 'let s={...t.environment,HOME:"/home/zpl",USER:"zpl",LOGNAME:"zpl"};for(let A of["SRT_PROXY_PORT"'
if a5 in w:
    w = w.replace(a5, b5, 1); changed.append("F:real-home")

open(ah, 'w').write(w)

s = open(lx).read()

# ---- D) sandbox-runtime: 重新放行循环跳过符号链接 ----
# Agent Helm 用 denyRead=["/"] + 逐条 --ro-bind 放行;/bin/appletviewer 等软链
# bwrap --ro-bind <symlink> <symlink> 会 "Can't create file"。软链在 --ro-bind / / 里已可见。
anchor = '''            if (!fs.existsSync(allowPath)) {
                logForDebugging(`[Sandbox Linux] Skipping non-existent read allow path: ${allowPath}`);
                continue;
            }
'''
add = '''            try {
                if (fs.lstatSync(allowPath).isSymbolicLink()) {
                    logForDebugging(`[Sandbox Linux] Skipping symlink read allow path (bwrap cannot bind over a symlink): ${allowPath}`);
                    continue;
                }
            } catch { }
'''
if anchor in s and 'Skipping symlink read allow path' not in s:
    s = s.replace(anchor, anchor + add, 1); changed.append("D:skip-symlink")

# ---- E) sandbox-runtime: 关闭网络隔离(允许 SSH 等原始 TCP 出网) ----
a4 = "bwrapArgs.push('--unshare-net');"
if a4 in s:
    s = s.replace(a4, "/* network isolation disabled by local patch */", 1); changed.append("E:no-unshare-net")

open(lx, 'w').write(s)

print("applied: " + (", ".join(changed) if changed else "none (already patched)"))
PY

log "done"
