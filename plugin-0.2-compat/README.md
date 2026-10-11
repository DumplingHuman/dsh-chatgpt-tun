# `@beforewave/dsh-with-chatgpt` 适配 dsh 0.2.x

上游插件 `@beforewave/dsh-with-chatgpt@0.1.4` 的 peer 范围是 `>=0.1.1-rc.2 <0.2.0`，
在最新版 dsh（`0.2.x`）上会挂。这里是我们自己做的适配版，**已在 `0.2.1-alpha.2` 上实测跑通**
（面板渲染、Agent Helm core、隧道、serena、LSP、`command_execute` + `ssh` 全部正常）。

## 为什么上游跑不了（3 个真实断点）

| # | 断点 | 0.1.x | 0.2.x |
|---|---|---|---|
| 1 | 图标命名 | `IconCodeOutline16` / `IconChevronDownOutline14`（尺寸写进名字） | `IconCodeOutline` + `Regular/Medium` 变体，尺寸改走 `size` prop → 旧的导入变 `undefined` → React 崩 **#130** |
| 2 | Agent presets | `@deepseek-ai/dsh-agent-presets` + `ctx.agentPresets` 手动 mount | 包被删除，改成"声明式 preset"由 host registry eager 激活 |
| 3 | 会话/持久化 API | `persistence.inspect()` → `{events, meta}`；`session.events` | `persistence.open()/read()/close()` → `SessionHandle`；`session.snapshotEvents()` |

附带：`dsh-client-runtime` 包被删（`ClientContext` 现在就是 `@deepseek-ai/cordis` 的 `Context`；
`slots` 服务改由 `dsh-client-ui-renderer` 声明）；`AgentSetup` 签名变成 `(agentCtx, agent)`。

## 改了什么

见 `dsh-0.2-compat.patch`（相对上游 `v0.1.4`，9 个文件 / +148 −89）：

- **`src/app/icon-compat.ts`（新增）**：运行时图标解析器，按
  `IconXxxOutlineRegular → IconXxxOutline → IconXxxOutline14` 顺序取第一个存在的导出，
  取不到就渲染 `null`。**一份构建同时兼容 0.1.x 和 0.2.x**。
- **`src/dsh/adapter.ts`**：去掉 `dsh-agent-presets`（退回插件本来就有的"只装 model selection"分支）；
  `inspect()` → `open('read')` + `read()` + `header` + `close()`；`session.events` → `snapshotEvents()`；
  `#installSelection(agentCtx, agent)` 接收第二参数。
- **`src/index.ts`**：`inject` 去掉 `agentPresets`。
- **`src/client.tsx`**：`ClientContext` 改用 cordis；补 `dsh-client-ui-renderer/client` 类型导入。
- **`package.json`**：`@deepseek-ai/*` 升到 `0.2.1-alpha.2`，去掉 `dsh-agent-presets`/`dsh-client-runtime`，
  client `inject` 用 `dsh-client-ui-renderer` 顶替 `dsh-client-runtime`。

## 安装

**方式 A：直接用编好的包（推荐）**

```bash
# 假设 dsh 是 0.2.x 版本
cd <你的 dsh 仓库>
pnpm dsh plugin --profile web add /path/to/dsh-with-chatgpt-0.1.4-dsh02.tgz
# 然后重启 dsh web
```

若 profile 里已注册过 `adapterId: dsh`（比如另有一个 dsh 实例也跑这个插件），
在 profile 的 `cordis.patch.yml` 里覆盖一下，避免 conflict：

```yaml
- id: dsh-with-chatgpt
  config:
    adapterId: dsh02
```

**方式 B：从源码构建**

```bash
./install-0.2.sh --from-source
```

脚本会 clone 上游 `v0.1.4`、打上 `dsh-0.2-compat.patch`、`npm install --legacy-peer-deps && npm run build`，
再用 `dsh plugin add` 装进 profile。

## 实测环境

- dsh `0.2.1-alpha.2`（commit `d743267388`，`master`）
- 插件 `0.1.4` + 本补丁
- Agent Helm `0.1.4`（沙箱补丁见本仓库根目录）
- Node `22.19.0`，pnpm `11.28.5`

> 注意：升级 `@deepseek-ai/*` 到更新版本后，上面的 API 锚点可能再次变化，需要按同样思路重新对齐。
