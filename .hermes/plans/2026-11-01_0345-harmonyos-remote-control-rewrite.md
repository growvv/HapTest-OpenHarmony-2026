# HarmonyOS 遥控能力重写：可执行任务清单与验收标准

> **For Hermes:** 按任务顺序执行，每个 Task 单独 commit。Task 内的「验收」不通过就不要进入下一个 Task。

**Goal:** 把 `feat/harmonyos-replica-consolidated` 上"编译能过、单测全绿、真机用不了"的 HarmonyOS 遥控实现，重做成**一条可自动重跑的真机链路 + 一个能被 Codex 真正发现的 MCP 入口**。

**Architecture:** 保留现有三层（HapTest 设备层 / `src/device/harmony` session 层 / `src/mcp` 协议层）和安全不变量设计；重做交付面（E2E、安装、自检）、会话所有权（去全局单例）、以及三处"靠猜"的实现（App 名、锁屏、认证字段）。widget 移出首版。

**Tech Stack:** TypeScript 5 / CommonJS / Node 24 / vitest 3 / `@modelcontextprotocol/sdk` 1.32 / zod 3 / HDC + uitest agent + Hypium RPC。

**前置文档:** `develop/harmonyos-rewrite-analysis.md`（问题清单 P0-1 ~ P3-15，本计划的每个 Task 都对应其中的编号）。

---

## 0. 决策（默认值已定，可推翻）

| # | 决策 | 默认值 | 影响 |
| --- | --- | --- | --- |
| D1 | 首版宿主 | **只做 Codex CLI 的 stdio MCP**，widget 移出首版 | M6 变成"删除"而不是"改造" |
| D2 | 真机 E2E | JUY-AL50 可随时接入；无设备时 **SKIP 并退出 0** | T1.4/T1.5 |
| D3 | 工具面 | 冻结现有 **17 个设备工具**的名字与语义，不增不减；widget 4 个删除 | 避免边改协议边改实现 |
| D4 | App 显示名 | **删除 33 条硬编码表**，改为设备读取；读不到只返回 `bundleName` | T4.2/T4.3 |
| D5 | 分支策略 | 新分支 `feat/harmonyos-remote-control` 基于 `origin/main`；旧分支原样保留到验收通过 | T0.1 |

> 如果 D1 改成"首版就要 widget"，则 M6 保留但必须先满足 T2.6（宿主能装）+ T1.5（真机能跑），并且 widget 的验收必须在**目标宿主**上做，不能再用临时网页宿主代替。

---

## 1. 全局验收清单（Definition of Done）

全部满足才算重写完成。每条都必须能用一条命令复现。

| # | 验收项 | 命令 | 期望 |
| --- | --- | --- | --- |
| A1 | 构建与单测 | `npm run build && npm test -- --run` | 退出码 0；无新增失败 |
| A2 | 真机 E2E | `npm run e2e` | 有设备：全部步骤 PASS 并打印每步耗时；无设备：`SKIPPED` + 指引，退出码 0 |
| A3 | 安装自检 | `bash scripts/install.sh` | 末尾打印 `verify-mcp: 17 tools OK`；`codex mcp list` 中 `haptest` 指向本仓库 `lib/mcp/main.js` |
| A4 | 缺 HDC 的指引 | `env PATH=/usr/bin:/bin ./node_modules/.bin/ts-node src/cli/cli.ts doctor` | 打印"安装 DevEco Command Line Tools + 把 hdc 加入 PATH"的可执行指引，退出码 1，**不打印裸错误码** |
| A5 | 无硬编码猜测 | `grep -rn "APP_DISPLAY_NAME_GUESSES" src/ test/` | 无输出 |
| A6 | 无模块级可变单例 | `grep -n "^const activeSerials" src/device/harmony/session.ts` | 无输出（改为 `SessionRegistry` 实例） |
| A7 | 新增 HDC 调用不走 shell | `grep -n "shell: true" src/device/hdc.ts` | 仅存在于既有代码的既有行；新增方法（`getAppCatalog`/`isKeyguardLocked`/`inputFocusedText`）全部 `shell: false` |
| A8 | 文档不吹牛 | 人工检查 `develop/harmonyos-replication-handoff.md` | 每个"通过"后面都跟着一条可复制命令 |

---

## 2. 里程碑与任务

### 里程碑 0：干净地基（约 2 小时）

#### Task 0.1 新建重写分支

**目标:** 从一个没有历史包袱的基线上开始。

**文件:** 无（只动 git）

**步骤:**
```sh
cd /Users/rogn/Documents/code/vibe/HapTest
git fetch origin
git switch -c feat/harmonyos-remote-control origin/main
git log --oneline -1          # 期望 45c85df
```

**验收:** `git status --short --branch` 显示 `## feat/harmonyos-remote-control`，且与 `origin/main` 无差异。

---

#### Task 0.2 以"未验证基线"导入旧实现（1 个 commit）

**目标:** 保留可复用的代码，但在 commit message 里明确它未经真机验证，后续每个 Task 才逐步"点亮"。

**文件（只导入这些，不要导入文档与 widget HTML）:**
```
src/device/harmony/errors.ts
src/device/harmony/selectors.ts
src/device/harmony/lease.ts
src/device/harmony/doctor.ts
src/device/harmony/session.ts
src/mcp/main.ts
src/mcp/server.ts
bin/haptest-mcp
test/unit/harmony_session.test.ts
test/unit/harmony_mcp.test.ts
test/unit/harmony_doctor.test.ts
test/unit/device_lease.test.ts
test/unit/hdc_focused_text.test.ts
```

**步骤:**
```sh
git checkout feat/harmonyos-replica-consolidated -- \
  src/device/harmony src/mcp bin/haptest-mcp \
  test/unit/harmony_session.test.ts test/unit/harmony_mcp.test.ts \
  test/unit/harmony_doctor.test.ts test/unit/device_lease.test.ts \
  test/unit/hdc_focused_text.test.ts
npm run build && npx vitest run test/unit/harmony_session.test.ts
git add -A && git commit -m "chore(harmonyos): import unverified baseline implementation

Imported from feat/harmonyos-replica-consolidated. Builds and unit tests
pass, but no real-device verification exists yet. Do not treat as working."
```

**验收:** `npm run build` 通过；`npx vitest run test/unit/harmony_session.test.ts` 12 项通过。

---

#### Task 0.3 重新应用对基础层的 4 处改动（1 个 commit，逐文件 review）

**目标:** 把 `device.ts` / `hdc.ts` / `uitest_agent.ts` 的改动作为**独立可 review 的 commit** 加回来，避免和 session 代码混在一起。

**文件:**
- 修改 `src/device/device.ts`（`dumpViewTree(dismissKeyboard=true)`、`getLiveDisplaySize()`）
- 修改 `src/device/hdc.ts`（`Hdc.getVersion()`、`inputFocusedText()`）
- 修改 `src/device/uidriver/uitest_agent.ts`（`UitestAgent.diagnose()`）

**步骤:**
```sh
git checkout feat/harmonyos-replica-consolidated -- \
  src/device/device.ts src/device/hdc.ts src/device/uidriver/uitest_agent.ts
npm run build
git add src/device/device.ts src/device/hdc.ts src/device/uidriver/uitest_agent.ts
git commit -m "feat(device): add side-effect-free observe and agent diagnostics"
```

> 此处**保留** `Device.startScreenCapture`，因为 T0.2 导入的 `session.ts` 还在用它。它的删除放在 T6.1，与 preview 一起做，保证每个 commit 都能编译。

**验收:** `npm run build` 通过；`git show --stat HEAD` 只含这 3 个文件。

---

#### Task 0.4 清掉过期分支与 stash

**目标:** 让 `git branch -a` 只剩有意义的分支。

**步骤:**
```sh
# 先留底，再删
git stash show -p stash@{1} > /tmp/haptest-legacy-mcp-1.patch
git stash show -p stash@{4} > /tmp/haptest-legacy-mcp-4.patch
# 注意：drop 之后序号会前移，必须从大到小删
git stash drop stash@{4}
git stash drop stash@{1}

git branch -D feat/agent-version-adaptation feat/native-screen-streaming \
  fix/rpc-agent-error-diagnostics refactor/device-lifecycle \
  fix/screen-viewer-reconnect-state feat/harmonyos-replica-rebased \
  feat/harmonyos-iphone-use-replica
git tag -d backup-pre-linefix
```

**验收:** `git branch` 只剩 `main` 与 `feat/harmonyos-remote-control`（`feat/harmonyos-replica-consolidated` 保留到 A2 通过再删）；`git stash list` 只剩 0 条或 2 条无关项。

**注意:** 远端分支删除需要权限，先只删本地；远端清理命令写进 PR 描述由你执行。

---

#### Task 0.5 清理本机旧产物（不动 git）

**目标:** 让 `npm pack` / `install.sh` 不会被 10 月的旧编译产物污染。

**步骤:**
```sh
rm -rf lib/ out/
rm -rf plugins/haptest-harmonyos/node_modules plugins/haptest-harmonyos/package.json
npm run build
```

**验收:** `ls lib/mcp` 只有 `main.js`/`server.js`/`*.d.ts`/`*.map`；`npm pack --dry-run 2>&1 | tail -3` 的文件数与 `lib/` 实际文件数一致。

---

### 里程碑 1：一条可自动重跑的真机 E2E（核心，约 1 天）

> 没有 M1，后面的所有 Task 都只是在"改一个没人验证过的东西"。

#### Task 1.1 加 E2E 脚本入口

**目标:** `npm run e2e` 一条命令可用。

**文件:**
- 修改 `package.json`（scripts）
- 修改 `vitest.config.mjs`（排除 e2e，避免 `npm test` 去连设备）

**步骤:**

`package.json` 新增：
```json
"e2e": "node -r ts-node/register/transpile-only test/e2e/run.ts"
```

`vitest.config.mjs` 保持 `include: ['test/unit/**/*.test.ts']` 不变（已经是这样，不用改；确认即可）。

**验收:** `npm run e2e` 能启动（此时会因为文件不存在而报错，属预期）。

---

#### Task 1.2 写 E2E harness（连接 + 计时 + 清理）

**目标:** 所有 E2E 步骤共享一个带计时的 runner，失败也一定 `close()`。

**文件:** 新建 `test/e2e/harness.ts`

**步骤:**

```ts
import { HarmonyDeviceSession } from '../../src/device/harmony/session';

export interface StepResult { name: string; ms: number; detail?: string }

export class E2eRunner {
    private readonly results: StepResult[] = [];
    constructor(private readonly session: HarmonyDeviceSession) {}

    async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
        const started = Date.now();
        const value = await fn();
        this.results.push({ name, ms: Date.now() - started });
        console.log(`PASS  ${name}  ${Date.now() - started}ms`);
        return value;
    }

    report(): void {
        const total = this.results.reduce((sum, item) => sum + item.ms, 0);
        console.log('\nStep                          ms');
        for (const item of this.results) console.log(`${item.name.padEnd(30)}${item.ms}`);
        console.log(`TOTAL${' '.repeat(25)}${total}`);
    }
}

export function requireSerial(): string {
    const serial = process.env.HAPTEST_E2E_SERIAL;
    if (!serial) {
        console.log('SKIPPED: set HAPTEST_E2E_SERIAL to the target device serial.');
        console.log('Find it with: hdc list targets');
        process.exit(0);
    }
    return serial;
}
```

**验收:** 新建 `test/e2e/tsconfig.json`（`{"extends":"../../tsconfig.json","include":["."]}`）后，`npx tsc --noEmit -p test/e2e/tsconfig.json` 通过。根 `tsconfig.json` 的 `include` 只有 `src`，不要改它。

---

#### Task 1.3 写 E2E 主流程（可逆、不碰敏感账户）

**目标:** 一条覆盖 `observe → apps → launch → tap → press_key → observe → disconnect` 的链路。

**文件:** 新建 `test/e2e/run.ts`

**步骤:**

```ts
import { HarmonyDeviceSession } from '../../src/device/harmony/session';
import { E2eRunner, requireSerial } from './harness';

async function main(): Promise<void> {
    const serial = requireSerial();
    const session = await HarmonyDeviceSession.connect({ serial });
    const runner = new E2eRunner(session);
    try {
        const first = await runner.step('observe(tree)', () => session.observe());
        if (first.locked) throw new Error('Device is locked; unlock it and rerun.');

        await runner.step('apps(list)', async () => {
            const apps = session.findApps();
            if (apps.length < 10) throw new Error(`Unexpectedly small app catalog: ${apps.length}`);
            return apps.length;
        });

        const target = 'com.huawei.hmos.settings';
        await runner.step('launch_app(settings)', () => session.launchApp(target));

        const afterLaunch = await runner.step('observe(after launch)', () => session.observe());
        if (afterLaunch.bundleName !== target) {
            throw new Error(`Foreground is ${afterLaunch.bundleName}, expected ${target}`);
        }

        const search = afterLaunch.tree!.getComponents()
            .find((component) => component.type === 'SearchField' && component.bounds && component.id);
        if (search?.id) {
            await runner.step('tap(search field)', () => session.tap({ selector: { id: search.id } }));
        } else {
            console.log('SKIP  tap(search field)  no uniquely identified SearchField on this screen');
        }

        await runner.step('press_key(BACK)', () => session.pressKey('BACK'));
        await runner.step('observe(final)', () => session.observe());
        runner.report();
    } finally {
        await session.close();
    }
}

void main().catch((error) => {
    console.error('E2E FAILED:', error);
    process.exit(1);
});
```

**验收:**
- 无设备：`npm run e2e` 打印 `SKIPPED: set HAPTEST_E2E_SERIAL ...`，退出码 0。
- 有设备：所有步骤 PASS，最后打印每步耗时表。

**注意:** 如果 Settings 没有 `SearchField`，`tap` 步骤会被跳过（`if (search)`），不要为了"跑满"而硬点坐标。

---

#### Task 1.4 把"真机跑过"变成文档里的第一条证据

**目标:** 让下一个人知道怎么跑，而不是读聊天记录。

**文件:** 新建 `develop/harmonyos-e2e.md`

**内容（三节即可）:**
```markdown
# HarmonyOS E2E

## 前置
- HDC 在 PATH（`hdc version` 有输出）
- 设备已授权（`hdc list targets` 显示 connected）
- `HAPTEST_E2E_SERIAL=<serial>`

## 运行
    npm run e2e

## 判定
- 退出码 0 且每步 PASS：链路可用
- `SKIPPED`：没有设置 serial，不算失败也不算通过
- 任一步 FAILED：把完整输出贴到 handoff 的"已知限制"
```

**验收:** 文件存在，且 `npm run e2e` 的输出格式与文档描述一致。

---

#### Task 1.5 真机验收（需要设备）

**目标:** 拿到第一次真实的端到端证据。

**步骤:**
```sh
hdc list targets
HAPTEST_E2E_SERIAL=<serial> npm run e2e
```

**验收:** 全部步骤 PASS；把耗时表原样贴进 `develop/harmonyos-replication-handoff.md` 的"验收记录"。如果失败，**不要继续 M2**，先修到绿——M1 的失败就是后续所有工作的前置阻塞。

---

### 里程碑 2：安装链路（约半天）

#### Task 2.1 给 CLI 加真正的 `mcp` 子命令

**目标:** 让 `haptest mcp` 真的启动 MCP server（修 P0-2）。

**文件:** 修改 `src/cli/cli.ts`（在 `program.command('screen')` 之后插入）

**步骤:**
```ts
program
    .command('mcp')
    .description('Start the HapTest HarmonyOS MCP server on stdio')
    .action(async () => {
        require('../mcp/main');
    });
```

**验收:** `node bin/haptest mcp` 不再打印 `At least one -i/--hap is required.`，而是阻塞等待 stdio（`Ctrl+C` 退出）。

---

#### Task 2.2 给 CLI 加 `doctor` 子命令（缺 HDC 时给人话）

**目标:** 修 P0-1，让第一条信息是"去装什么"，不是错误码。

**文件:** 修改 `src/cli/cli.ts`；新建 `src/cli/doctor_command.ts`

**步骤:**

`src/cli/doctor_command.ts`:
```ts
import { doctorHarmonyDevices } from '../device/harmony/doctor';
import { HarmonyDeviceError } from '../device/harmony/errors';

const HDC_HELP = [
    'hdc was not found on PATH.',
    '',
    'Install DevEco Studio or the DevEco Command Line Tools, then add its',
    'toolchains directory to PATH, for example:',
    '  export PATH="$HOME/Library/Huawei/Sdk/openharmony/<version>/toolchains:$PATH"',
    '',
    'Verify with: hdc version && hdc list targets',
].join('\n');

export async function runDoctorCommand(options: { target?: string }): Promise<void> {
    try {
        const report = doctorHarmonyDevices({ serial: options.target });
        console.log(JSON.stringify(report, null, 2));
        process.exitCode = report.issues.length > 0 ? 1 : 0;
    } catch (error) {
        if (error instanceof HarmonyDeviceError && error.code === 'HDC_UNAVAILABLE') {
            console.error(HDC_HELP);
        } else {
            console.error(error instanceof Error ? error.message : String(error));
        }
        process.exitCode = 1;
    }
}
```

`src/cli/cli.ts` 新增：
```ts
program
    .command('doctor')
    .description('Diagnose HDC, device and uitest agent readiness')
    .option('-t, --target [connectkey]', 'hdc connectkey')
    .action(async (cmdOptions) => {
        await runDoctorCommand({ target: cmdOptions.target });
    });
```

**验收:** 按 A4 的命令执行，输出包含 `Install DevEco Studio` 字样，退出码 1。

---

#### Task 2.3 重写 `install.sh`：只做"注册 MCP + 自检"

**目标:** 修 P0-3，不再依赖 `codex plugin list --json` 的 grep。

**文件:** 修改 `scripts/install.sh`（整体替换）

**步骤:**
```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v node >/dev/null || { echo "node is required" >&2; exit 1; }
command -v codex >/dev/null || { echo "codex CLI is required" >&2; exit 1; }

rm -rf "$ROOT/lib"
npm install --prefix "$ROOT" --no-audit --no-fund
npm --prefix "$ROOT" run build

# 幂等：先移除旧条目，再按绝对路径注册
codex mcp remove haptest >/dev/null 2>&1 || true
codex mcp add haptest -- node "$ROOT/lib/mcp/main.js"

node "$ROOT/scripts/verify-mcp.mjs" "$ROOT/lib/mcp/main.js"
echo "HapTest MCP registered. Restart Codex to reload it."
echo "Next: haptest doctor  (or codex mcp list)"
```

**验收:** `bash scripts/install.sh` 退出码 0，最后一行是 `verify-mcp: 17 tools OK`。

---

#### Task 2.4 写 `verify-mcp.mjs`（自检，替代"人工 listTools"）

**目标:** 安装脚本自己证明工具真的能被发现。

**文件:** 新建 `scripts/verify-mcp.mjs`

**步骤:**
```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const entry = process.argv[2];
if (!entry) { console.error('usage: verify-mcp.mjs <server-entry.js>'); process.exit(2); }

const REQUIRED = [
    'doctor', 'devices', 'ready', 'observe', 'tap', 'find', 'swipe',
    'double_tap', 'long_press', 'drag', 'press_key', 'press_button',
    'type_text', 'apps', 'launch_app', 'stop_app', 'disconnect',
];

const transport = new StdioClientTransport({ command: 'node', args: [entry], stderr: 'inherit' });
const client = new Client({ name: 'haptest-verify', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);
const { tools } = await client.listTools();
await client.close();

const names = tools.map((tool) => tool.name);
const missing = REQUIRED.filter((name) => !names.includes(name));
if (missing.length) {
    console.error(`verify-mcp: missing tools: ${missing.join(', ')}`);
    process.exit(1);
}
console.log(`verify-mcp: ${REQUIRED.length} tools OK`);
```

**验收:** 手动跑 `node scripts/verify-mcp.mjs lib/mcp/main.js` 输出 `verify-mcp: 17 tools OK`；把 `REQUIRED` 里删掉一个名字再跑，退出码 1。

---

#### Task 2.5 更新 `uninstall.sh`

**文件:** 修改 `scripts/uninstall.sh`

**步骤:** 主体改为：
```bash
codex mcp remove haptest >/dev/null 2>&1 || true
rm -rf "$ROOT/lib"
echo "HapTest MCP removed."
```

**验收:** `bash scripts/uninstall.sh && codex mcp list | grep -c haptest` 输出 `0`。

---

#### Task 2.6 隔离环境验收（不动真实 `~/.codex`）

**步骤:**
```sh
export CODEX_HOME=/tmp/haptest-codex-verify
bash scripts/install.sh
codex mcp list
node scripts/verify-mcp.mjs "$PWD/lib/mcp/main.js"
bash scripts/uninstall.sh
unset CODEX_HOME
```

**验收:** 装 → 列出 → 自检 17 工具 → 卸载后为空；真实 `~/.codex` 未被修改（`ls ~/.codex/plugins/cache/haptest-local` 仍是旧内容，等你自己确认后再手工清理）。

---

### 里程碑 3：会话所有权与恢复（约半天）

#### Task 3.1 用 `SessionRegistry` 替换模块级 `activeSerials`

**目标:** 修 P1-5，让会话所有权可注入、可测试、可并测。

**文件:** 新建 `src/device/harmony/registry.ts`；新建 `test/unit/session_registry.test.ts`

**步骤:**

```ts
import { HarmonyDeviceError } from './errors';

export class SessionRegistry {
    private readonly owned = new Set<string>();

    acquire(serial: string): void {
        if (this.owned.has(serial)) {
            throw new HarmonyDeviceError('DEVICE_BUSY', `HarmonyOS device ${serial} already has an active HapTest session.`, { serial });
        }
        this.owned.add(serial);
    }

    release(serial: string): void {
        this.owned.delete(serial);
    }

    has(serial: string): boolean {
        return this.owned.has(serial);
    }
}

export const defaultSessionRegistry = new SessionRegistry();
```

测试（3 项）：同一 registry 重复 acquire 抛 `DEVICE_BUSY`；release 后可再 acquire；两个独立 registry 可各自持有同一 serial。

**验收:** `npx vitest run test/unit/session_registry.test.ts` 3 项通过。

---

#### Task 3.2 让 `connect()` 使用注入的 registry

**文件:** 修改 `src/device/harmony/session.ts`

**步骤:**
- `HarmonySessionDependencies` 增加 `registry?: SessionRegistry`，默认 `defaultSessionRegistry`。
- 删除 `const activeSerials = new Set<string>();`。
- `connect()` 里 `activeSerials.has/add/delete` 改成 `this.dependencies.registry.has/acquire/release`（注意 `connect` 是静态方法，用参数里的 dependencies）。
- `closeOnce()` 里 `activeSerials.delete(this.serial)` 改成 `this.dependencies.registry.release(this.serial)`。

**验收:** `grep -n "activeSerials" src/device/harmony/session.ts` 无输出；全仓 `npx vitest run` 仍全过。

---

#### Task 3.3 明确"恢复"的语义（只读重连，不重放）

**目标:** 修 P1-5 的第二半：链路断了以后有一条被文档化的路。

**文件:** 修改 `src/device/harmony/session.ts`；修改 `src/mcp/server.ts`

**步骤:**
- `session.ts` 新增 `isClosed(): boolean`。
- `server.ts` 的 `ready` 在 `state.session?.isClosed()` 时先 `close()` 并置空，再新建（现在会直接复用已关闭的 session）。
- `nextStepFor('SESSION_CLOSED')` 已经是"Call ready"，不用改。

**验收:** 新增单测：`session.close()` 后调用 `tap` 抛 `SESSION_CLOSED`；MCP `ready` 在 session 已关闭时能重新连上（用 fake deps 断言 `connect` 被调用两次）。

---

### 里程碑 4：把"猜"换成"读"（约 1 天）

#### Task 4.1 探测：设备上到底哪个命令能一次拿到应用名

**目标:** 在写代码前先确认事实，避免又造一个猜测表。

**文件:** 新建 `develop/harmonyos-probe-app-labels.md`

**步骤（有设备时）:**
```sh
hdc -t <serial> shell bm dump -a | head -20
hdc -t <serial> shell aa dump -l | head -40
hdc -t <serial> shell bm dump -n com.huawei.hmos.settings | head -60
hdc -t <serial> shell hidumper -s AbilityManagerService -a '-a' | head -60
```
把每条命令的**耗时**和**是否含本地化 label 字段**记进文档。

**验收:** 文档里明确写出"采用哪条命令、为什么、耗时多少"；如果四条都拿不到批量 label，就明确写"首版只返回 bundleName，不做显示名"，**不要回退到硬编码表**。

---

#### Task 4.2 用探测结果实现 `getAppCatalog()`

**文件:** 修改 `src/device/hdc.ts`；新建 `test/unit/hdc_app_catalog.test.ts`

**步骤:** 按 T4.1 的结论实现，形如：
```ts
getAppCatalog(): Array<{ bundleName: string; label?: string }> {
    const output = this.excuteShellCommandSync(...['<探测确定的命令>']);
    // 解析：一行一个 bundle，能拿到 label 就带上，拿不到就只给 bundleName
}
```
用 `vi.spyOn` 锁死解析逻辑（喂真实输出样本，断言结果），**不要 mock 掉整个方法**。

**验收:** 单测 3 项（有 label / 无 label / 空输出）通过；新增方法使用 `excuteShellCommandSync` 的**参数数组**形式，不拼字符串。

---

#### Task 4.3 删掉 33 条硬编码表

**文件:** 修改 `src/device/harmony/session.ts`；修改 `test/unit/harmony_session.test.ts`

**步骤:**
- 删除 `APP_DISPLAY_NAME_GUESSES`（整块，不留兜底）。
- `findApps(query)` 改为：`const catalog = this.device.getAppCatalog()`，匹配 `bundleName` 或 `label`（都 `toLowerCase()`）。
- 返回结构保留 `displayName`/`displayNameSource`，但 `displayNameSource` 只可能是 `'device_metadata'`；没有 label 就不返回 `displayName`。
- 测试改成：有 label 时返回 `device_metadata`；无 label 时只有 bundleName；搜索中文 label 命中。

**验收:** `grep -rn "APP_DISPLAY_NAME_GUESSES" src test` 无输出；`npx vitest run test/unit/harmony_session.test.ts` 通过。

---

#### Task 4.4 锁屏判定：读状态，认不到就当锁定

**文件:** 修改 `src/device/hdc.ts`、`src/device/harmony/session.ts`；新建 `test/unit/keyguard.test.ts`

**步骤:**
- `Hdc.isKeyguardLocked(): boolean | undefined`（`undefined` = 无法判断）。
- `session.ts` 的 `isLockScreen(page)` 改成 `isLockScreen(page, keyguard)`：
  ```ts
  function isLockScreen(page: Page, keyguard: boolean | undefined): boolean {
      if (keyguard !== undefined) return keyguard;
      const known = page.getComponents().some((component) =>
          component.id === 'ScreenLockRootComponent' || component.id === 'MainPageView_Screen_Lock_Home');
      if (known) return true;
      // 无法确认锁屏状态时按已锁定处理：宁可少给屏幕内容，也不泄露。
      return true;
  }
  ```
- 所有调用点传入 keyguard 查询结果。

**验收:** 单测覆盖 `true`/`false`/`undefined` 三种；`undefined` 时 `observe()` 不返回 tree 和 screenshot。

---

#### Task 4.5 认证字段：改成"确认是普通字段才允许输入"

**文件:** 修改 `src/device/harmony/session.ts`；修改 `test/unit/harmony_session.test.ts`

**步骤:**
- 把 `isSensitiveField` 反转为 `isConfirmedOrdinaryField(component)`：
  ```ts
  const ORDINARY_INPUT_TYPES = new Set(['TextInput', 'TextArea', 'SearchField']);
  const AUTH_FIELD = /(pass(word|wd|code|phrase)?|pin|otp|one.?time|2fa|mfa|captcha|verification|verify|security.?code|token|credential|auth|密码|口令|验证码|认证)/i;

  function isConfirmedOrdinaryField(component: Component): boolean {
      if (!ORDINARY_INPUT_TYPES.has(component.type ?? '')) return false;
      return ![component.id, component.name, component.hint]
          .some((value) => typeof value === 'string' && AUTH_FIELD.test(value));
  }
  ```
- `typeText` 里 `if (isSensitiveField(...)) throw` 改成 `if (!isConfirmedOrdinaryField(...)) throw new HarmonyDeviceError('SENSITIVE_FIELD', ...)`。

**验收:** 单测：未知 `type` 的输入组件被拒；id 含 `password` 被拒；普通 `SearchField` 通过。

---

### 里程碑 5：`observe` 成本与输入回读（约半天）

#### Task 5.1 把 3 次 UI dump 降到 1 次

**文件:** 修改 `src/device/harmony/session.ts`

**步骤:**
- 保留第一次 `dumpViewTree`（拿 tree + bundle）。
- 截图前后的锁屏检查改用 `this.device.getHdc().isKeyguardLocked()`（轻量 shell），不再 dump。
- 只有 keyguard 状态从 `false` 变成 `true` 时才重新 dump 一次并清掉 tree。

**验收:** 单测断言 `dumpViewTree` 在 `observe({screenshot:true})` 里被调用 **1 次**（当前是 3 次）。

---

#### Task 5.2 让 Agent 能读回输入框内容

**目标:** 修 P2-11（`toJson()` 把输入框文本清空，模型永远看不到字段内容）。

**文件:** 修改 `src/mcp/server.ts`（新增工具）、`src/device/harmony/session.ts`（新增方法）

**步骤:**
- `session.ts` 新增：
  ```ts
  readField(selector: HarmonySelector): { text: string; focused: boolean } {
      this.ensureOpen();
      const page = this.latestTree;
      if (!page) throw new HarmonyDeviceError('ACTION_PRECONDITION_FAILED', 'Observe the screen before reading a field.');
      const matches = findHarmonyComponents(page, selector);
      if (matches.length !== 1) {
          throw new HarmonyDeviceError('AMBIGUOUS_TARGET', 'read_field requires exactly one match.', {
              candidates: summarizeHarmonyCandidates(matches),
          });
      }
      return { text: matches[0].text ?? '', focused: matches[0].focused === true };
  }
  ```
- `server.ts` 注册 `read_field`（selector 必填），描述里写明"只读，仅用于普通字段；认证字段会被拒绝"。
- **D3 例外说明:** 这是首版唯一新增的工具，因为不新增就无法验证输入结果。如果要严格冻结 17 个，则把 `type_text(verify)` 的返回值改成 `{ verified, actualLength }` 作为替代。

**验收:** 单测：唯一匹配返回 text；多匹配报 `AMBIGUOUS_TARGET`；E2E 里 `type_text` 后可 `read_field` 读回。

---

### 里程碑 6：widget 移出首版（约 1 小时）

#### Task 6.1 删除 widget 代码路径

**目标:** 修 P1-7，不让 390 行代码挂在一个目标宿主不渲染的路径上。

**文件:**
- 修改 `src/mcp/server.ts`：删除 `registerScreenPreview()`、`screenPreviewHtml`、`registerScreenPreview` 的调用；删除 `HarmonyObservation` 之外的 preview 相关 import。
- 修改 `src/device/device.ts`：删除 `startScreenCapture()`、`screenCaptureStream`、`screenCaptureStarting` 及 `teardownDriver` 里的停流代码（`ScreenCaptureStream` 仍被 `screen_viewer_server.ts` 直接使用，不要删那个文件）。
- 修改 `src/device/harmony/session.ts`：删除 `startPreview()`/`pausePreview()`/`getPreviewFrame()`/`stopPreviewInternal()`、`previewStop`/`previewFrame` 字段、`SessionDevice.startScreenCapture` 接口项、`ScreenCaptureFrame` import。
- 修改 `test/unit/harmony_mcp.test.ts`：删除 preview 相关断言，工具数改为 17（或 18，若 T5.2 保留 `read_field`）。

**验收:** `npx vitest run` 全过；`node scripts/verify-mcp.mjs lib/mcp/main.js` 输出 17/18 tools OK；`grep -rn "screen_preview\|mcp-app" src/` 无输出。

---

#### Task 6.2 记录"为什么删"

**文件:** 修改 `develop/harmonyos-rewrite-analysis.md`（在 P1-7 末尾加一行"处置"）

**步骤:** 加：
```markdown
**处置（M6）:** 已从首版删除。原因：目标宿主 Codex CLI 不渲染 MCP Apps；保留它等于维护一条永远不会被执行的代码路径。若将来接入支持 MCP Apps 的宿主，从 `feat/harmonyos-replica-consolidated` 的 `b7718a5` 取回，并按"推送而非 1.2s 轮询"重做。
```

**验收:** 文档里有这段，且不再声称"widget 已完成验收"。

---

### 里程碑 7：文档收敛（约 1 小时）

#### Task 7.1 把 handoff 压成三节

**文件:** 重写 `develop/harmonyos-replication-handoff.md`

**结构（只保留这三节）:**
```markdown
# HarmonyOS 交接

## 1. 当前状态
- 分支 / HEAD / 工作区
- `npm run build`、`npm test -- --run`、`npm run e2e` 的**实际输出**

## 2. 集成缺口（按 P 编号）
- 每条：问题 / 现状 / 下一步 / 复现命令

## 3. 已知限制
- 每条必须写"怎么发现的"和"怎么复现"
```

**验收:** 文件 ≤ 80 行；每个"通过"后面都有命令；没有"人工在聊天里验过"这类表述。

---

#### Task 7.2 删除过程性文档

**步骤:**
```sh
git rm develop/harmonyos-replica-commit-review.md \
       develop/harmonyos-replication-handoff-template.md \
       doc/harmonyos_widget_support.md
```

**验收:** `wc -l develop/*.md` 总数从 818 降到 ≤ 350。

---

#### Task 7.3 更新 guide 的"当前基线"章节

**文件:** 修改 `develop/harmonyos-replication-guide.md`

**步骤:** 把第 7–19 行的"当前基线（2026-10-17）/当前验证状态"整段替换为：
```markdown
## 当前状态

以 `develop/harmonyos-replication-handoff.md` 为准。任何"已实现/已验收"的结论
必须能由 `npm run build`、`npm test -- --run`、`npm run e2e` 或
`node scripts/verify-mcp.mjs lib/mcp/main.js` 之一复现。
```

**验收:** guide 里不再出现硬编码的提交 hash、工具数量、设备型号作为"当前状态"。

---

## 3. 提交粒度

每个 Task 一个 commit，message 用 `type(scope): summary`：

| Task | commit message |
| --- | --- |
| 0.2 | `chore(harmonyos): import unverified baseline implementation` |
| 0.3 | `feat(device): add side-effect-free observe and agent diagnostics` |
| 1.1–1.4 | `test(e2e): add a repeatable real-device smoke chain` |
| 2.1 | `feat(cli): add mcp subcommand` |
| 2.2 | `feat(cli): add doctor subcommand with actionable HDC guidance` |
| 2.3–2.5 | `build(mcp): register the server with codex and verify tool discovery` |
| 3.1–3.3 | `refactor(harmony): inject session ownership and allow read-only reconnect` |
| 4.1 | `docs(harmonyos): record app label probe results` |
| 4.2–4.3 | `feat(device): read app labels from the device instead of guessing` |
| 4.4 | `fix(harmony): treat unknown lock state as locked` |
| 4.5 | `fix(harmony): require a confirmed ordinary field before typing` |
| 5.1 | `perf(harmony): stop re-dumping the tree to check the keyguard` |
| 5.2 | `feat(mcp): add read_field for ordinary input values` |
| 6.1–6.2 | `refactor(mcp): drop the unrenderable screen preview widget` |
| 7.1–7.3 | `docs(harmonyos): replace status prose with reproducible commands` |

---

## 4. 风险与回滚

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 没有可用的 HDC / 真机 | M1 无法验收，整个计划卡住 | T0 之后立刻确认 `hdc version`；没有就先做 M2（安装自检不需要设备），M1 标为阻塞 |
| 设备上拿不到批量 app label（T4.1 失败） | `apps` 只能返回 bundleName | 明确接受并在 handoff 写"按名称搜索不可用"，**不回退硬编码表** |
| `isKeyguardLocked` 在目标机型不可用 | 锁屏判定退回组件 id，且"认不到=锁定"会让正常场景被拒 | 先用 `HAPTEST_KEYGUARD_PROBE=1` 打日志观察真实输出，再定默认值 |
| 删除 widget 引起 `device.ts` 回归 | `screen_viewer_server` 依赖 `ScreenCaptureStream` | T6.1 只删 `Device.startScreenCapture`，不动 `screen_capture_stream.ts`；`npm test` 里有 `screen_capture_stream.test.ts` 兜底 |
| Codex 版本差异（0.162 vs 0.164） | `codex mcp add` 行为不同 | T2.6 在隔离 `CODEX_HOME` 里验；失败就退回"手写 `~/.codex/config.toml` 片段"，把片段打印给用户 |

**回滚:** 每个 Task 一个 commit，`git revert <sha>` 即可；旧分支 `feat/harmonyos-replica-consolidated` 在 A2 通过前不删除。

---

## 5. 执行顺序建议

```
M0 (0.1→0.5)  ──►  M2 (2.1→2.6)  ──►  M1 (1.1→1.5)  ──►  M3  ──►  M4  ──►  M5  ──►  M6  ──►  M7
   地基            无设备也能验          真机闭环          会话       读代替猜     成本     删      文档
```

**把 M2 提到 M1 之前**：安装自检不需要设备，可以先拿到一个"Codex 真的能发现 17 个工具"的确定性结果；然后再花时间在真机 E2E 上。如果设备不在手边，M2 做完就已经比现在可用。
