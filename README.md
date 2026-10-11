# Agent Helm / DSH-with-ChatGPT 命令沙箱修复（Linux / WSL2）

修复 `@beforewave/agent-helm` + `@anthropic-ai/sandbox-runtime` 的 `command_execute` 在 **Linux / WSL2** 上不可用的问题，并让沙箱内可以直接 `ssh` 到目标机。

- 适用版本：`@beforewave/agent-helm@0.1.4`、`@anthropic-ai/sandbox-runtime@0.0.74`
- 目标：`@beforewave/dsh-with-chatgpt` 插件（DSH 0.1.1-rc.2）的 ChatGPT 连接器

---

## 现象

ChatGPT 通过插件调用 `command_execute` 时返回：

```
command_execution_unavailable
reason: capability_unavailable      # 或 resource_unavailable
layer: system
```

即使 `bwrap` / `socat` 已安装、daemon 启动日志显示 `sandbox-runtime phase=preflight status=ready`，命令依然跑不起来；或能进沙箱但 bwrap 报 `Can't create file at /bin/appletviewer`，或 `apply-seccomp: not found`。

## 根因（叠加的 6 个问题）

| # | 问题 | 说明 |
|---|---|---|
| A | Agent Helm 在 Linux 上仍套用 **macOS Seatbelt 的 glob 转义** | 把 allowRead 路径编码成 `/bin/[b]ash`，而真实存在的 `/bin/[` 可执行文件含 `[` → 抛 `sandbox_policy_unsupported` |
| B | 默认 `denyRead=["/"]`，再逐条放行 | `/etc`、`~/.ssh` 等全被 tmpfs 挡住 |
| C | 默认 write deny 同样过严 | 影响已知 `/bin` 软链的放行路径 |
| D | `sandbox-runtime` 重新放行循环用 `--ro-bind <symlink> <symlink>` | bwrap 无法对软链建挂载点 → `Can't create file`（如 `/bin/appletviewer`） |
| E | 沙箱强制 `--unshare-net` | 网络命名空间隔离，SSH 等原始 TCP 直接不可用 |
| F | Agent Helm 用**托管 HOME** | `ssh` 读不到真实 `~/.ssh/config` 与密钥 |

---

## 修复内容

- **A**：Linux 下 `Rt()` 直接返回原路径，不做 glob 编码。
- **B / C**：清空沙箱 read/write deny。
- **D**：`sandbox-runtime` 重新放行时跳过符号链接。
- **E**：关闭 `bwrap --unshare-net`（放行出网）。
- **F**：沙箱内 `HOME` / `USER` 使用真实值。
- **配置**：`~/.config/agent-helm/config.yml` 增加 `~/.ssh` 可写（让 `ssh` 能更新 known_hosts）以及 sandbox-runtime 目录只读（让 `apply-seccomp` 在沙箱内可见）。

> 打完之后，命令沙箱基本等价于**直通壳**：文件系统全读、网络全通、真实 HOME。
> 这是一个**有意放弃隔离**的改动，仅适合本机自用/内网环境。

## 使用

```bash
# 1) 应用补丁（幂等，可重复执行）
./patch-agenthelm-sandbox.sh

# 2) 把补丁挂到 daemon 启动前，避免 pnpm install 覆盖后失效
#    见 systemd/agent-helm-daemon.service 里的 ExecStartPre
sudo cp systemd/agent-helm-daemon.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user restart agent-helm-daemon
systemctl --user restart dsh-watch

# 3) 复制 config 示例并按需修改
cp config.agent-helm.example.yml ~/.config/agent-helm/config.yml
```

## 验证

通过插件的 MCP（或直接在 ChatGPT 里）执行：

```
pwd; hostname; id -un; ls ~/.ssh
ssh <target> "systemctl --user is-active <service>"
```

期望：`return_code: 0`、`stderr` 为空。

## 文件

| 文件 | 作用 |
|---|---|
| `setup.sh` | 一键复现整个环境（clone 对应 tag + 装插件 + 打补丁 + systemd） |
| `VERSIONS.md` | 版本锁定清单 + 为什么不能用最新版 |
| `patch-agenthelm-sandbox.sh` | 幂等补丁脚本（A–F） |
| `config.agent-helm.example.yml` | Agent Helm 用户配置示例 |
| `wait-agent-helm.sh` | 等待 daemon(3457) 就绪，供 `dsh-watch` 的 `ExecStartPre` 使用 |
| `systemd/agent-helm-daemon.service` | daemon 常驻 + `ExecStartPre` 自动打补丁 |
| `plugin-0.2-compat/` | 把 `@beforewave/dsh-with-chatgpt` 适配到 dsh **0.2.x**（源码补丁 + 预编译包 + 安装脚本） |

## 让插件适配 dsh 0.2.x（已实测跑通）

上游插件 peer 上限是 `<0.2.0`，在最新的 dsh 0.2.x 上会挂。我们不靠等上游，自己改了：

- 断点 1：图标改成了 `IconCodeOutline` + `size` prop（旧名 `IconCodeOutline16` 变 `undefined` → React #130）
- 断点 2：`@deepseek-ai/dsh-agent-presets` 被删 → 退回只装 model selection
- 断点 3：`persistence.inspect()` / `session.events` → `open()/read()/snapshotEvents()`

详见 [`plugin-0.2-compat/README.md`](plugin-0.2-compat/README.md)，补丁见
[`plugin-0.2-compat/dsh-0.2-compat.patch`](plugin-0.2-compat/dsh-0.2-compat.patch)。

**在 `dsh 0.2.1-alpha.2` 上实测**：面板正常渲染（无 #130）、`core/tunnel/serena/localMcp/LSP` 全 running、
`command_execute` 可跑 `uname`，`ssh 174 "systemctl --user is-active dsh-web-8089"` → `active`。

## 注意事项

- 升级 `@beforewave/agent-helm` / `@anthropic-ai/sandbox-runtime` 后补丁锚点可能变化，需重新核对（脚本会打印 `applied:` 明细，打不上会提示 anchor not found 之外的 `none`）。
- 本仓库**不包含**任何密钥/令牌。
