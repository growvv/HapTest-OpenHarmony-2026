# HarmonyOS 设备 API + CLI 重写：设计

> 日期：2026-11-01 · 基线 `origin/main` = `45c85df`
> 决策来源：用户在四条路线中选定「转向内部 session API + CLI，MCP 以后再说」
> 现状依据：`develop/harmonyos-rewrite-analysis.md`（P0-1 ~ P3-17，每条带实测命令）

## 1. 意图与理由

把 HarmonyOS 控制能力做成 **HapTest 内部一等公民**：一个可被任意调用方（实验脚本、未来的 MCP、UI viewer、CLI）复用的 TypeScript API，加一套能被 shell / Python 直接驱动的 CLI。MCP 适配层、Codex 插件、widget 全部移出本轮范围。

为什么现在这么做：

- 仓库**根本没有公共 API 入口**：`package.json` 的 `main` 指向 `lib/index.js`，但 `src/index.ts` 不存在，所有能力只能靠相对路径 import。
- 唯一"打通"的链路是 MCP + 插件市场三层嵌套，而它在本机从未装成功（旧原型占着 `haptest` 名字）。
- 设备层本身是可用的：21 工具能被发现、租约与安全不变量设计正确；坏的是入口与验证。

## 2. 目标 / 非目标 / 反目标

**目标**

1. `import { HarmonyDevice } from 'haptest'` 可用，类型完整（`declaration: true` 已开）。
2. `haptest harmony <cmd>` 一次性命令 + `haptest harmony serve`（JSON-lines）两种驱动方式。
3. `npm run e2e` 一条命令在真机上跑完整链路；无设备 `SKIPPED` 退出 0。
4. 删除所有 MCP / 插件 / widget / 硬编码猜测代码与依赖。

**非目标**

- MCP server、Codex 插件、Skills、widget、屏幕预览。
- 应用本地化名（本轮只返回 `bundleName`）。
- 多设备并行、跨机型兼容矩阵、失败自动重连。

**反目标（技术上"做完了"也算失败）**

- 又出现一套只能在 mock 里跑的 API。
- CLI 每个命令各自连一次设备却假装有会话状态，导致坐标/observation 语义漂移。
- 为了"兼容"保留 MCP 依赖或 widget 死代码。

## 3. 约束

- TypeScript 5 / CommonJS / Node 24 / vitest 3；`tsconfig` 的 `include` 只有 `src`，E2E 用独立 tsconfig。
- `Hdc` 缺失时任何入口都必须给出"装 DevEco CLI Tools + 加 PATH"的人话，而不是裸错误码。
- 本机当前 `hdc` 不在 PATH；真机为 JUY-AL50（OpenHarmony 7.0.0.105 / API 26），不保证长期在线。
- 不改 HapTest 既有 CLI 行为（`ui-viewer` / `screen` / fuzz 默认流程）。

## 4. 方案

### 4.1 已选：API 为一等公民，CLI 是薄壳

| 层 | 内容 |
| --- | --- |
| `src/device/harmony/` | `HarmonyDevice` 门面 + `errors` / `selectors` / `lease` / `doctor`；**无协议依赖** |
| `src/index.ts`（新建） | 公共导出：`HarmonyDevice`、`HarmonyObservation`、`HarmonySelector`、`HarmonyDeviceError`、`doctorHarmonyDevices`、`discoverHarmonyDevices`，以及既有的 `Device` / `Fuzz` |
| `src/cli/harmony_command.ts`（新建） | commander 子命令组，只做参数解析 → 调 API → 输出 |
| `src/cli/harmony_serve.ts`（新建） | stdin/stdout JSON-lines 会话，方法 1:1 映射 API |

**被否决的两个方案**（记录取舍，避免以后重来）：

- *只做 CLI、不做 API*：实验脚本要解析 JSON 再拼命令，且无法在进程内保持 observation；拒绝。
- *保留 MCP、只是换个宿主*：等于把本轮要删的 500 行适配层与两个依赖继续背在身上；拒绝。

### 4.2 API 形状

```ts
const device = await HarmonyDevice.connect({ serial? });   // 无 serial 时按 0/1/多台判定
const obs = await device.observe({ screenshot?: boolean });
device.find(selector);                                      // 基于最近一次 observation
await device.tap({ selector, index? });                     // 或 { x, y, observationId }
await device.swipe({ from, to, observationId, speed? });
await device.typeText(text);                                // 无 verify
await device.pressKey('BACK');
device.apps(query?);                                        // [{ bundleName }]
await device.launchApp('com.huawei.hmos.settings');
await device.close();
```

保留的不变量：动作前必须有 observation；坐标动作绑定 `observationId` + 前台 bundle + 屏幕尺寸 + `contentSig`；selector 歧义返回候选不猜；`mutate()` 后 observation 失效；异常 → `ACTION_OUTCOME_UNCERTAIN` + `replayAction:false`；锁屏不返回 tree/screenshot。

### 4.3 我的判断（可推翻）

| # | 决定 | 理由 |
| --- | --- | --- |
| D1 | **删掉 `activeSerials` 全局 Set，只留文件租约** | 租约已提供跨进程独占（同进程重复 connect 会命中 EEXIST + 自身 pid 存活 → `DEVICE_BUSY`）。Set 是冗余概念，也是"泄漏一次全 busy"的来源 |
| D2 | **删掉 `typeText` 的 `verify`** | 期望值算法本身是错的（隐含光标在末尾），保留只会产生假失败 |
| D3 | **删掉 33 条硬编码 App 名表**，`apps()` 只返回 `bundleName` | 表外永远搜不到，且 `displayNameSource` 让调用方自己判断可信度 |
| D4 | **一次性 CLI 命令内部先 observe 再动作**，并支持 `--expect-bundle` / `--expect-sig` | 跨进程无法复用 observationId；用可打印的 bundle+contentSig 做等价校验 |
| D5 | **`serve` 必须有**，即使本轮只服务内部实验 | Agent 实验是"多步、有状态"的；一次性命令无法承载 observationId |
| D6 | **删 widget + `Device.startScreenCapture`** | 唯一消费者是预览路径；`haptest screen` 用的是 `ScreenCaptureStream`，不受影响 |
| D7 | **新分支 `feat/harmonyos-device-api`** ← `origin/main`；旧分支保留到 E2E 绿 | 避免在 45 个提交、3 份文档的历史上继续叠 |

### 4.4 CLI 契约

```sh
haptest harmony doctor   [--serial <s>] [--json]
haptest harmony devices  [--json]
haptest harmony observe  [--serial <s>] [--screenshot <file>] [--json]
haptest harmony apps     [--query <q>] [--json]
haptest harmony tap      (--id|--text|--text-contains|--hint|--name) [--index n] | (--x n --y n)
haptest harmony type     <text>
haptest harmony key      <BACK|HOME|ENTER|DELETE|SPACE|TAB|ESCAPE|UP|DOWN|LEFT|RIGHT>
haptest harmony swipe    --from x,y --to x,y [--speed n]
haptest harmony launch   <bundle>
haptest harmony stop     <bundle>
haptest harmony serve    [--serial <s>]
```

- 成功：结果 JSON 到 stdout，退出 0。`--json` 只影响人类可读摘要的去留。
- 退出码：`0` 成功 · `1` 动作/查询失败 · `2` 用法错误 · `3` 前置条件不满足（HDC 缺失 / 无设备 / 锁屏）。
- 失败：`{ ok:false, errorCode, message, nextStep }` 到 stdout，人话提示到 stderr。
- `serve`：`{"id":1,"method":"observe","params":{}}` → `{"id":1,"ok":true,"result":{...}}`；方法名与 API 同名；`close` 结束进程。手写严格校验，不引 schema 库。

### 4.5 删除清单

`src/mcp/`、`test/unit/harmony_mcp.test.ts`、`bin/haptest-mcp`、`plugins/`、`.agents/`、`scripts/install.sh`、`scripts/uninstall.sh`、`doc/harmonyos_codex.md`、`doc/harmonyos_widget_support.md`、`doc/harmonyos_tool_contract.md`、`develop/harmonyos-replica-commit-review.md`、`develop/harmonyos-replication-handoff-template.md`、`develop/harmonyos-replication-handoff.md`；`session.ts` 的 preview 三方法与 `startScreenCapture`；依赖 `@modelcontextprotocol/sdk`、`zod`。

保留：`src/device/harmony/{errors,selectors,lease,doctor}.ts`、`session.ts` 的主体与不变量、对 `device.ts`/`hdc.ts`/`uitest_agent.ts` 的 4 处改动、`test/unit/{harmony_session,harmony_doctor,device_lease,hdc_focused_text}.test.ts`（随删除项调整）。

### 4.6 文档

只留两份：`develop/harmonyos-device-api.md`（API + CLI + 退出码 + E2E 用法）与本设计。`harmonyos-replication-guide.md` 的安全不变量并入新文档后删除——目标已从"复刻 iPhone-use"改成"内部 API"。

## 5. 验收（每条一条命令）

| # | 验收 | 命令 | 期望 |
| --- | --- | --- | --- |
| A1 | 构建 | `npm run build` | exit 0 |
| A2 | 单测 | `npx vitest run` | 全绿，且不再有 mcp 测试 |
| A3 | 公共 API | `node -e "console.log(Object.keys(require('./lib')))"` | 含 `HarmonyDevice`、`HarmonyDeviceError` |
| A4 | 缺 HDC 的人话 | `env PATH=/usr/bin:/bin node bin/haptest harmony doctor` | 打印 DevEco 指引，exit 3 |
| A5 | CLI 契约 | `node bin/haptest harmony doctor --json; echo $?` | 合法 JSON + exit 3 |
| A6 | 真机 E2E | `HAPTEST_E2E_SERIAL=<s> npm run e2e` | 全步 PASS + 每步耗时；无 serial → `SKIPPED` exit 0 |
| A7 | 无残留 | `grep -rn "@modelcontextprotocol\|APP_DISPLAY_NAME_GUESSES\|activeSerials" src/ test/ package.json` | 无输出 |

## 6. 留给实现者的部分

- `serve` 的并发语义：单会话串行（复用 `serialize`），不做多连接。
- `apps()` 的返回是否带 `versionName`：默认不带，需要时再加。
- E2E 的目标 App：默认 `com.huawei.hmos.settings`，可用 `HAPTEST_E2E_BUNDLE` 覆盖。
- `--screenshot` 的落盘路径与格式：直接写 PNG 字节，不转码。

## 7. 需要用户确认的一件事

`serve`（JSON-lines 有状态会话）是否在本轮就做。做了，实验脚本可以一次连上、连续观察/动作；不做，就只能靠一次性命令 + `--expect-sig` 兜底。默认：**做**（D5）。
