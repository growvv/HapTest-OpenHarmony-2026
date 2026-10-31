# HarmonyOS 复刻：现状审计与重写决策（复核版）

> **历史文档。** 本文是 2026-11-01 重写前的审计与路线评估，保留作为证据链。最终采纳的路线是「内部 API + CLI」（本文第 7 节的路线 C），MCP / 插件 / widget 已从代码中删除。当前能力与用法见 [`harmonyos-device-api.md`](harmonyos-device-api.md)。

> 日期：2026-11-01（复核上一版同日审计，所有结论以本次实测为准）
> 审计对象：`feat/harmonyos-replica-consolidated`（HEAD `ab70a19`），基线 `origin/main` = `45c85df`
> 方法：读源码 + 实跑构建/测试/协议握手/安装链路；分支内文档一律当"待核实声明"
> 结论先行：**代码骨架可用，坏在交付链路与验证手段。** 21 个工具能被发现，但没有一条能自动重跑的真机链路；本机 `~/.codex` 里挂的还是 10 月 13 日的旧原型。重写预算应花在"一条能重跑的 E2E + 一个能自检的安装"，而不是重排目录。

---

## 0. 本次实测记录（每条都可重跑）

| # | 命令 | 实测结果 | 结论 |
| --- | --- | --- | --- |
| E1 | `npm run build` | exit 0（`NODE_ENV=development` 恢复 devDeps 后） | 编译不是问题 |
| E2 | `npx vitest run` | 19 files / 55 tests 全过，1.4s | 单测不是问题，但见 P0-4 |
| E3 | `StdioClientTransport` spawn `lib/mcp/main.js` → `listTools()` | 21 tools + 1 `ui://` resource，connect 603ms | 协议层结构正确 |
| E4 | `node bin/haptest mcp` | 打印 `[ERROR] At least one -i/--hap is required.`，**exit 1** | CLI 没有 `mcp` 子命令 |
| E5 | `which hdc` | 空 | 本机无法做真机验证（前置条件缺失，不是代码缺陷） |
| E6 | MCP 调 `doctor` / `devices` / `ready` | 三个都返回 `HDC_UNAVAILABLE` + `nextStep` 人话指引 | 错误面比上一版审计记录的好 |
| E7 | `codex --version` | `0.164.0` | handoff 的验收环境是 0.162.1 |
| E8 | `codex mcp list` | `haptest → haptest mcp`，cwd = `~/.codex/plugins/cache/haptest-local/haptest/0.2.3` | 装的是旧原型 |
| E9 | `cat ~/.codex/plugins/cache/haptest-local/haptest/0.2.3/mcp.json` | `{"command":"haptest","args":["mcp"]}`；skills = `setup`/`device-control` | 与 E4 对上：这条配置必然是死的 |
| E10 | `codex plugin list` | `haptest-harmonyos@haptest-project  not installed` | 本分支的插件从未装进真实 `~/.codex` |
| E11 | `~/.codex/config.toml` | 仍有 `[marketplaces.haptest-local]` 与 `[plugins."haptest@haptest-local"] enabled=true` | 新旧插件会产生同名 MCP server `haptest` 冲突 |
| E12 | `NODE_ENV=production bash scripts/install.sh` | `sh: tsc: command not found`，脚本中止 | 安装脚本被环境变量坑死 |
| E13 | `NODE_ENV=development CODEX_HOME=/tmp/... bash scripts/install.sh` | exit 0；插件缓存含 `node_modules`；`codex mcp list` → `node .../bin/haptest-mcp`；握手 21 tools | **安装链路本身是通的** |
| E14 | 只 `codex plugin add`（不先 npm install 到插件目录） | 插件缓存无 `node_modules`；MCP 条目指向不存在的 cwd → `spawn node ENOENT` | 少一步就得到一个"静默不启动"的条目 |
| E15 | `git diff --stat origin/main <每个分支>` | 5 个分支出现 `-128`/`-1792`/`-2119` 行；`fix/screen-viewer-reconnect-state` 与 origin/main 完全相同 | 过期快照，可删 |
| E16 | `git diff --stat feat/harmonyos-iphone-use-replica HEAD -- src test` | 只差 `harmony_session.test.ts` 的 `afterEach`（+49/-20） | 三个鸿蒙分支 = 一份代码 |
| E17 | `grep -rn "vi.mock\|new Device\|StdioClientTransport" test/` | 新增测试全部 mock 设备；无 `test/e2e/` | "55 项通过"证明不了真机行为 |

### 对上一版审计的更正

- **C1**：`node bin/haptest mcp` 的退出码是 **1**，不是 0（上一版写"exit 0"）。"宿主拿到正常退出的进程"这一机制描述不成立，但结论不变：它不启动 MCP。
- **C2**：`doctor` 在 MCP 层已经给出 `nextStep`（"Install DevEco Command Line Tools and add hdc to PATH…"），不是裸错误码。缺的是 **CLI 层 `haptest doctor`** 和 **安装前自检**，P0-1 降级为 P1。
- **C3**：新插件的 `mcp.json` 指向 `node ${PLUGIN_ROOT}/node_modules/haptest/bin/haptest-mcp`，**是正确的**；`install.sh` 在干净环境下全程成功（E13）。"安装脚本从来没成功过"不准确——真实原因是本机从未在正确环境下跑过它，且旧插件仍占着 `haptest` 这个名字。
- **C4**：`NODE_ENV=production` 会让脚本里的 `npm install` 剪掉 devDependencies，随后 `tsc` 消失（E12）。脚本没有显式 `--include=dev`，报错也不指向真正原因。
- **C5**：只跑 `codex plugin add`、不先往插件目录装 runtime，会得到一个指向不存在 `node_modules` 的条目（E14）。这是"装完看着成功、实际不启动"的最短路径。

---

## 1. 分支全景：哪些东西真的是新的

### 1.1 真实基线

- 基线用 **`origin/main` = `45c85df`**。`git diff main...HEAD` 会把本地 main 侧的分叉算进来，不要用。
- 本地 `main`（`f622b17`）与 `origin/main` **内容上只差一个文件**：`src/event/ui_event.ts`（+15/-8，即 `9cb1cee fix(scroll): skip fling for undersized bounds`）。`f622b17` 是 screen fix 的重复提交，没有新内容。
  - 收敛方式：`git switch main && git reset --hard origin/main && git cherry-pick 9cb1cee`，把这个 scroll 修复单独提 PR 回去，否则会被遗忘。

### 1.2 每个分支的处置

| 分支 | 相对 origin/main | 内容 | 处置 |
| --- | --- | --- | --- |
| `feat/harmonyos-replica-consolidated`（当前） | 32 files, +3483/-6 | 本次审计对象 | 重写期间保留，验收后删 |
| `feat/harmonyos-iphone-use-replica` | 30 files, +3069/-5 | 最早实现 + 大量 handoff 提交 | 删（代码同 HEAD） |
| `feat/harmonyos-replica-rebased` | 31 files, +3122/-6 | consolidated 的前身 | 删 |
| `feat/agent-version-adaptation` | 4 files, +28/-130 | 已进 main（PR #12） | 删 |
| `feat/native-screen-streaming` | 3 files, +20/-128 | 已进 main（PR #14） | 删 |
| `fix/rpc-agent-error-diagnostics` | 25 files, +370/-2119 | 已进 main（PR #10） | 删 |
| `refactor/device-lifecycle` | 17 files, +156/-1792 | 已进 main（PR #13） | 删 |
| `fix/screen-viewer-reconnect-state` | IDENTICAL | 就是 origin/main | 删 |

**三个鸿蒙分支、45 个提交，产出的源码只有一份**（约 1600 行 src + 700 行测试），其余全是文档。这就是"乱"的量化证据。

### 1.3 stash

5 条 stash，其中 `stash@{1}` / `stash@{4}` 是更早的 MCP 原型（改 `hdc.ts` / `device.ts` / `cli.ts`），与 `src/device/harmony/` 无重叠。先 `git stash show -p > /tmp/legacy.patch` 留底，再按序号**从大到小** drop。

---

## 2. 这份实现想做什么

目标（guide 里这一层是清楚的，值得保留）：

> 用 HapTest 已有的 HDC + uitest agent + Hypium RPC 栈，提供一套可被 LLM Agent 调用的 HarmonyOS 手机操作能力，对标 iPhone-use；入口是 **MCP stdio server**，宿主先是 Codex CLI。

分层（正确，不要推翻）：

| 层 | 职责 |
| --- | --- |
| `src/device/`（HapTest 基础层） | 设备发现、连接、UI 树、动作、会话独占、安全不变量 |
| `src/device/harmony/`（新增 1022 行） | session façade、selector、doctor、跨进程租约、错误码 |
| `src/mcp/`（新增 500 行） | 只做 schema / 参数映射 / 结果编码 |

---

## 3. 已实现（逐项，带行号）

### 3.1 `src/device/harmony/`

| 文件 | 行数 | 内容 |
| --- | --- | --- |
| `session.ts` | 792 | `HarmonyDeviceSession`：连接/观察/动作/预览/App 查询；`activeSerials` 全局 Set 在 L67；33 条 bundle→中文名硬编码表在 L72-106 |
| `lease.ts` | 94 | 跨进程文件租约（`$TMPDIR/haptest-device-<sha>.lock/owner.json`，pid+token，死进程可回收，rename 防 ABA） |
| `selectors.ts` | 52 | `HarmonySelector{id,text,textContains,hint,name,type,enabled}` → 组件列表 |
| `doctor.ts` | 49 | 只读诊断：HDC 版本、targets、uitest/agent 兼容性、daemon endpoint |
| `errors.ts` | 35 | 19 个领域错误码 |

动作面：`observe`、`find`、`tap`（selector 或坐标）、`swipe`、`doubleTap`、`longPress`、`drag`、`pressKey`、`pressButton`、`typeText`、`findApps`、`launchApp`、`stopApp`、`startPreview/pausePreview/getPreviewFrame`、`close`。

安全不变量（设计对，值得保留）：动作前必须有 observation；坐标动作绑定 `observationId` + 前台 bundle + 屏幕尺寸 + `contentSig`；selector 歧义返回候选不猜；`mutate()` 后 observation 立即失效；异常统一 `ACTION_OUTCOME_UNCERTAIN` + `replayAction:false`；锁屏不返回 tree/screenshot。

### 3.2 `src/mcp/`

17 个设备工具 + 4 个 widget 工具 + `ui://haptest-harmonyos/screen-preview` resource（内联 HTML，1.2s 轮询）。错误编码 `errorCode/message/details/nextStep/replayAction`。

### 3.3 对基础层的改动（4 处，质量可接受，建议沿用）

- `device.ts`：`dumpViewTree(dismissKeyboard=true)` 开关、`getLiveDisplaySize()`、`startScreenCapture()`（单流，teardown 先停流）。
- `hdc.ts`：`Hdc.getVersion()`、`Hdc.inputFocusedText()`（`shell:false`）。
- `uitest_agent.ts`：`UitestAgent.diagnose()`。
- `screen_viewer_server.ts` / `res/screen-viewer/static/app.js`：视图层小改。

### 3.4 交付面

`plugins/haptest-harmonyos/`（plugin.json + mcp.json + 2 个 SKILL.md）、`.agents/plugins/marketplace.json`、`scripts/install.sh`、`scripts/uninstall.sh`、`bin/haptest-mcp`、3 份 doc。

---

## 4. 为什么"没法用"

### P0（换个人接手必然踩到）

- **P0-1 本机 `~/.codex` 挂的是旧原型，且新插件从未安装。** 证据 E8/E9/E10/E11。旧条目的 `mcp.json` 是 `haptest mcp`，而 CLI 没有这个子命令（E4）→ 工具永远不出现。新插件 `haptest-harmonyos@haptest-project` 状态 `not installed`；旧 marketplace `haptest-local` 仍启用，装新插件会出现两个同名 `haptest` server。
- **P0-2 安装脚本对 `NODE_ENV` 敏感，失败信息误导。** E12：`NODE_ENV=production` 下 `npm install` 剪掉 devDeps，`tsc` 消失，脚本在 build 阶段中止。脚本没有 `--include=dev`，也没有"装完自检 listTools"。
- **P0-3 安装结果无法被判定。** `codex plugin list --json | grep` 跟着输出格式走；`set -e` 只保证命令返回非零，不保证插件真的能被宿主拉起（E14 就是"看着成功、实际不启动"）。
- **P0-4 唯一"打通"的是 in-memory 测试。** `harmony_mcp.test.ts` 用 `InMemoryTransport` + 全 mock；`harmony_session.test.ts` 造假 `SessionDevice`。606 行里没有一行触碰真实 `Device`/`Hdc`/`UitestAgent`；没有 `test/e2e/`。handoff 里的"真机通过"是当时人工在设备上跑出来的，今天无法复现（E5：`hdc` 都不在 PATH）。

### P1

- **P1-5 会话是模块级单例。** `activeSerials`（L67）泄漏一次后续全 `DEVICE_BUSY`；`iphone-use-replica` 上"8 项失败中 7 项级联假失败"由此而来，consolidated 只用 `afterEach` 补了清理。设计问题：无法并测、无法失败后恢复。
- **P1-6 App 名靠 33 条硬编码中文映射。** 表外的 App 用中文名永远搜不到（用户最自然的用法）；返回 `displayNameSource: 'bundle_name_guess'` 让调用方自己判断可信度。
- **P1-7 widget 在目标宿主不可见。** Codex CLI 不渲染 MCP Apps widget；这条链路只在"本地网页宿主 + Playwright"验过。为 4 个工具付出 390 行 + 内联 HTML。
- **P1-8 `haptest mcp` 子命令不存在。** CLI 只有 `ui-viewer` / `screen`；`mcp` 被忽略后落到默认流程（E4）。这是旧配置直接死掉的原因，也说明"CLI 入口"和"MCP 入口"没有统一。

### P2（安全 / 成本 / 正确性）

- **P2-9 锁屏判定靠猜，失效方向危险。** 只认 `ScreenLockRootComponent` / `MainPageView_Screen_Lock_Home`（L756-760）；换机型识别不到 = 按未锁屏返回截图和 UI 树。
- **P2-10 认证字段靠正则，失效方向同样危险。** `AUTH_FIELD`（L117）匹配 id/name/hint；未标注的密码框会漏判 → 代输凭据。
- **P2-11 `typeText(verify)` 期望值算法错。** `expectedValue = 原文本 + 新文本`（L479），隐含"光标在末尾、纯追加"；中间插入必误报 `ACTION_VERIFICATION_FAILED`。
- **P2-12 `observe({screenshot:true})` 最多 dump 三次 UI 树**（L226、L242、L253），每次是一次 Hypium RPC；`observe` 是 Agent 每步都调的。
- **P2-13 输入框内容恒为空。** `Component.text` 的 `@Transform` 对 `TextInput/TextArea/SearchField` 返回 `''`（`src/model/component.ts:64-69`），`observe` 走 `toJson()`，模型看不到字段里已有什么；只能依赖 P2-11 那个错的 verify。
- **P2-14 底座 `shell: true`。** `hdc.ts` L420/L440/L464 仍把内容拼进命令字符串走 shell；新增的 `inputFocusedText` 特意改 `shell:false` 并写了单测——修一个点、不修一类。
- **P2-15 `launchApp` 3 次 HDC 往返。** `requireObservation` → `getAllBundleNames()`（`bm dump -a`，实测 1.5s 量级）→ `getHapInTarget` → `getBundleInfo`（1.6s 量级）→ `startAblity`；前两次只为校验，而 `aa start` 本身会失败。

### P3

- **P3-16 文档替代验证。** `develop/` 4 份文档 818 行，其中 353 行是逐提交评审说明；评审说明超过被评审代码体量的三分之一。
- **P3-17 测试假宽。** 19 个文件里只有 5 个测新增代码，且全部 mock 设备。

---

## 5. 没实现什么

| 能力 | 声称 | 实际 |
| --- | --- | --- |
| 阶段 1 连接与观察 | ✅ | 已实现，只有 mock 测试；全局单例 |
| 阶段 2 动作与安全不变量 | ✅ | 已实现；锁屏/认证靠猜；verify 有已知误报 |
| 阶段 3 MCP 薄适配 | ✅ | 21 工具可发现；CLI 入口缺失 |
| 阶段 4 插件与安装 | ✅ 隔离 CODEX_HOME 验收 | 隔离环境确实能装通（E13）；真实 `~/.codex` 未迁移，旧条目仍占名 |
| 阶段 5 屏幕预览 widget | ✅ | 有实现；目标宿主不渲染 |
| 阶段 6 效率工具 | 部分 | `apps` 靠硬编码；`batch`/`scroll_find`/`collect_list` 明确暂缓 |
| **端到端闭环（真实模型在 Codex 里完成一个任务）** | — | **从未实现** |
| **失败恢复 / 重连** | 只在文档里 | 代码里没有；失败只能 `disconnect` 再来 |
| **跨机型 / 版本兼容** | 首版只支持 JUY-AL50 | 无兼容矩阵、无自动化手段 |
| **可复现的真机测试** | — | **不存在** |
| **观测延迟 / 交互成本度量** | — | 只有一次手工 `bm dump` 计时 |

一句话：**功能树画得很全，树干（一条能自动重跑的真机链路）是空的。**

---

## 6. 重写范围：保留 / 重做 / 删除

| 分类 | 内容 |
| --- | --- |
| **保留** | 三层分层；`errors.ts` 错误码体系；`selectors.ts`；`lease.ts`；`session.ts` 的安全不变量（observation 绑定、歧义不猜、不重放）；`src/mcp` 的错误编码；对 `device.ts`/`hdc.ts`/`uitest_agent.ts` 的 4 处改动 |
| **重做** | 真机 E2E；安装/宿主接入（幂等 + 自检）；`SessionRegistry`；App 名/锁屏/认证字段从"猜"改"读"；`observe` 成本与输入回读 |
| **删除** | widget 4 工具 + 内联 HTML + `Device.startScreenCapture`（唯一消费者是 widget 路径）；33 条硬编码名表；`harmonyos-replica-commit-review.md`；5 条过期分支 + 5 条 stash；本机旧插件/旧 marketplace |

**不要推倒重写代码。** 代码骨架是可用的，坏的是交付链路和验证手段。

---

## 7. 重写的三条路线

### 路线 A：基于 origin/main 重建分支，保留 17 工具与分层（推荐）

- 新分支 `feat/harmonyos-remote-control` ← `origin/main`；旧实现以**单个 commit** 导入并标注 "unverified baseline"。
- 先写 `npm run e2e`（observe → apps → launch → tap → press_key → observe → disconnect，每步计时；无设备 SKIPPED 退出 0）。
- 安装改为 `codex mcp add haptest -- node <abs>/lib/mcp/main.js` + `scripts/verify-mcp.mjs` 自检；插件/Skills 作为可选项，先清掉 `haptest@haptest-local`。
- 再依次修 P1-5/6/8、P2-9/10/11/13；widget 移出首版。
- 取舍：保留最大能力面与 Skills 生态；工作量中等（约 3-4 天）；继承的复杂度主要是插件打包。

### 路线 B：最小 10 工具 MCP，只走 `codex mcp add`

- 只保留 `doctor/devices/ready/observe/find/tap/type_text/press_key/launch_app/disconnect`。
- 丢掉 widget、插件市场、Skills、swipe/drag/double_tap/long_press/stop_app。
- 取舍：最快拿到"能用"（1-2 天），验证面最小；但工具面缩水，后续加回来要再改协议。

### 路线 C：先只做 HapTest 内部 API + CLI，暂不做 MCP

- 把 session 做成 HapTest 内部可复用 API，CLI 提供 `doctor`/`observe`/`act`，E2E 跑通后再接 MCP。
- 取舍：设备层最扎实；但用户目标就是"LLM 能操作手机"，MCP 交付被推迟，且 CLI 与 MCP 两套入口要维护。

**推荐 A**，但把"安装"换成路线 B 的做法（`codex mcp add` 绝对路径 + 自检），插件只保留 Skills 分发。这样既不丢能力面，也不再把"能不能用"押在插件市场的三层嵌套上。

---

## 8. 需要拍板的问题

1. **首版宿主与 widget**：只做 Codex CLI stdio MCP（widget 删除），还是要求 widget 在首版可见？
2. **真机 E2E 资源**：JUY-AL50 能否长期插着跑 `npm run e2e`？不能的话 E2E 只能半自动，重写价值打折。
3. **工具面**：冻结 17 个，还是按路线 B 压到 10 个？
4. **旧分支/远端**：本地 7 个分支 + 5 条 stash 是否现在就清（远端删除需要权限，先只删本地）？
