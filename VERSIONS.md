# 版本锁定（可复现）

这套 ChatGPT ↔ 本地 DSH 的连接**必须**使用下面这组版本，缺一不可。

| 组件 | 版本 | 说明 |
|---|---|---|
| deepseek-harness (dsh) | **`dsh-v0.1.1-rc.2`**（commit `b150a551b8`） | **不能用最新的 0.2.x** |
| `@beforewave/dsh-with-chatgpt` | `0.1.4` | 插件本体；peer 要求 dsh `>=0.1.1-rc.2 <0.2.0` |
| `@beforewave/agent-helm` | `0.1.4` | 插件依赖的本地能力层 |
| `@anthropic-ai/sandbox-runtime` | `0.0.74` | Agent Helm 命令沙箱依赖 |
| serena | `serena-agent 1.7.0`（uv 安装） | 语义工具 |
| tunnel-client | `v0.0.13` | OpenAI Secure Tunnel 客户端 |

## 为什么不能用最新版？

`@beforewave/dsh-with-chatgpt@0.1.4` 是按 **dsh 0.1.x** 的客户端/宿主接口编译的，实测：

| dsh 版本 | 结果 |
|---|---|
| `0.1.1-rc.2` | ✅ 插件正常（`# DSH with ChatGPT` 面板、语义工具、隧道、SSH 全通） |
| `0.1.7-rc.2` | ❌ 插件 `failed to import`（0.1.7 已移除 `@deepseek-ai/dsh-agent-presets`，插件仍 import 它） |
| `0.2.1-alpha.2` | ❌ 侧边栏 `sidebar.footer.action` 崩 React #130（图标 `IconCodeOutline16/IconWarningOutline16` 在 0.2.x 被删）；`@dsh-external/workflow`、`whale-girl` 等也不兼容 |

也就是说：**要等 `@beforewave/dsh-with-chatgpt` 出新版适配 0.2.x**，否则只能停在 `0.1.1-rc.2`。

## 克隆对应源码

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git dsh-official
cd dsh-official
git checkout dsh-v0.1.1-rc.2      # == b150a551b8
pnpm install
pnpm run build
```

（或直接用本仓库的 `setup.sh` 自动完成。）

## 随仓库附带的源码快照

为了在无法访问 GitHub 上游时也能复现，本仓库自带：

```
vendor/dsh-v0.1.1-rc.2-src.tar.gz        # 0.1.1-rc.2 源码快照 (git archive)
vendor/dsh-v0.1.1-rc.2-src.tar.gz.sha256 # sha256: 3a8a6ab18ef8cede2a75c59194b2b958dc4f98d9fc9901941daaaf3d30af3d9a
```

解开即可当作 dsh 源码目录（MIT License，版权归 DeepSeek，见上游 LICENSE）：

```bash
tar xzf vendor/dsh-v0.1.1-rc.2-src.tar.gz -C ~/dsh-official-src
cd ~/dsh-official-src && pnpm install && pnpm run build
```
