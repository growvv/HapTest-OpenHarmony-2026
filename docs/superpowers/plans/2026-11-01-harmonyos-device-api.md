# HarmonyOS Device API + CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 HarmonyOS 控制能力做成 `haptest` 的一等公共 API（`HarmonyDevice`）加一套可脚本化的 CLI（`haptest harmony …`），并删掉 MCP/插件/widget 全部交付面。

**Architecture:** 设备能力留在 `src/device/harmony/`（无协议依赖）；`src/index.ts` 作为唯一公共入口；`src/cli/harmony_command.ts` 是纯函数式薄壳（返回 `{exitCode, stdout, stderr}`，便于单测）；`src/cli/harmony_serve.ts` 提供 stdin/stdout JSON-lines 有状态会话。MCP 适配层整体删除。

**Tech Stack:** TypeScript 5 / CommonJS / Node 24 / vitest 3 / commander（仅既有命令使用）/ HDC + uitest agent + Hypium RPC。

**Spec:** `docs/superpowers/specs/2026-11-01-harmonyos-device-api-design.md`

## Global Constraints

- 基线 `origin/main` = `45c85df`；新分支 `feat/harmonyos-device-api`；不动 `main`。
- 不新增运行时依赖；删除 `@modelcontextprotocol/sdk`、`zod`。
- 退出码固定：`0` 成功 · `1` 动作/查询失败 · `2` 用法错误 · `3` 前置条件不满足（HDC 缺失 / 无设备 / 锁屏）。
- CLI 的 stdout **永远是 JSON**；人类可读摘要只写 stderr。因此不提供 `--json` 开关（与设计文档 4.4 的差异：去掉 `--json`，stdout 恒为 JSON）。
- 代码注释用英文、4 空格缩进、单引号、分号——与 `src/` 现有风格一致；文档用中文。
- `tsconfig.json` 的 `include` 只有 `src/**/*`，不要改；E2E 用 `test/e2e/tsconfig.json`。
- 每个 Task 结束时 `npm run build` 与 `npx vitest run` 必须同时绿，再提交。

## Review Focus

1. **`hdc` 不在 PATH**（CI、新机器）：所有入口必须给"装 DevEco CLI Tools + 加 PATH"的人话并退出 3，不能裸抛 `Error`。→ Task 5 测试。
2. **锁屏**：`observe` 不返回 tree/screenshot；动作命令必须拒绝并给"在设备上解锁"的指引，退出 3。→ Task 6 测试。
3. **selector 匹配多个**：返回候选列表、不猜；`--index` 越界退出 2。→ Task 7 测试。
4. **重复连接同一设备**（同进程或跨进程）：`DEVICE_BUSY`，且 `close()` 后能立刻重连。→ Task 3 测试。
5. **serve 的畸形输入**：非法 JSON、未知 method、缺 params 都必须返回 error 对象且进程不退出。→ Task 8 测试。

---

### Task 0: 分支与未验证基线

**Files:** 无（只动 git）

**Interfaces:**
- Consumes: 当前 `feat/harmonyos-replica-consolidated` 上的实现
- Produces: 分支 `feat/harmonyos-device-api`，含旧实现但未改造

- [ ] **Step 1: 建分支并导入**

```sh
git fetch origin
git switch -c feat/harmonyos-device-api origin/main
git checkout feat/harmonyos-replica-consolidated -- \
  src/device/harmony src/mcp bin/haptest-mcp \
  src/device/device.ts src/device/hdc.ts src/device/uidriver/uitest_agent.ts \
  test/unit/harmony_session.test.ts test/unit/harmony_mcp.test.ts \
  test/unit/harmony_doctor.test.ts test/unit/device_lease.test.ts \
  test/unit/hdc_focused_text.test.ts package.json
```

- [ ] **Step 2: 验证导入**

Run: `NODE_ENV=development npm install --include=dev --no-audit --no-fund && npm run build && npx vitest run`
Expected: build exit 0；19 files / 55 tests pass

- [ ] **Step 3: 提交**

```sh
git add -A
git commit -m "chore(harmonyos): import unverified baseline from consolidated branch

Builds and unit tests pass; no real-device verification exists yet."
```

---

### Task 1: 删除 MCP / 插件 / widget 交付面

**Files:**
- Delete: `src/mcp/`、`test/unit/harmony_mcp.test.ts`、`bin/haptest-mcp`、`plugins/`、`.agents/`、`scripts/install.sh`、`scripts/uninstall.sh`、`doc/harmonyos_codex.md`、`doc/harmonyos_widget_support.md`、`doc/harmonyos_tool_contract.md`
- Modify: `src/device/harmony/session.ts`（删 `startPreview`/`pausePreview`/`getPreviewFrame`/`stopPreviewInternal`、`previewStop`/`previewFrame` 字段、`ScreenCaptureFrame` import、`SessionDevice.startScreenCapture`）
- Modify: `src/device/device.ts`（删 `startScreenCapture`、`screenCaptureStream`/`screenCaptureStarting` 字段、teardown 里的停流块、`ScreenCaptureStream` import）
- Modify: `src/device/harmony/doctor.ts`（无改动，确认未引用 mcp）
- Modify: `package.json`（删 `@modelcontextprotocol/sdk`、`zod`、`haptest-mcp` bin、`mcp` script）
- Modify: `test/unit/harmony_session.test.ts`（删 preview 相关用例与 fake 成员）

**Interfaces:**
- Consumes: Task 0 的导入
- Produces: 无 preview 的 `HarmonyDeviceSession`；`ScreenCaptureStream` 仅剩 `src/ui/screen_viewer_server.ts` 一个消费者

- [ ] **Step 1: 删除文件与代码，然后验证无残留**

Run:
```sh
npm run build && npx vitest run
grep -rn "@modelcontextprotocol\|screen_preview\|haptest-mcp" src/ test/ package.json
```
Expected: build 0；测试全绿；grep 无输出

- [ ] **Step 2: 确认既有 `haptest screen` 未被破坏**

Run: `node bin/haptest screen --help`
Expected: 打印 `-t, --target` 等选项，exit 0

- [ ] **Step 3: 提交**

```sh
git add -A
git commit -m "refactor(harmonyos): remove MCP adapter, plugin packaging and screen preview"
```

---

### Task 2: 公共 API 入口 + 类重命名

**Files:**
- Create: `src/index.ts`
- Modify: `src/device/harmony/session.ts`（`HarmonyDeviceSession` → `HarmonyDevice`，含 `connect` 静态方法）
- Modify: `test/unit/harmony_session.test.ts`（同步改名）
- Test: `test/unit/public_api.test.ts`

**Interfaces:**
- Consumes: `HarmonyDeviceSession.connect(options, deps)`（Task 1 之后）
- Produces: `src/index.ts` 导出 `HarmonyDevice`、`HarmonyObservation`、`HarmonySelector`、`HarmonyCandidate`、`HarmonyDeviceError`、`HarmonyDeviceErrorCode`、`doctorHarmonyDevices`、`discoverHarmonyDevices`、`Device`、`Fuzz`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import * as api from '../../src';

describe('public API', () => {
    it('exports the HarmonyOS device facade', () => {
        expect(typeof api.HarmonyDevice.connect).toBe('function');
        expect(typeof api.HarmonyDeviceError).toBe('function');
        expect(typeof api.doctorHarmonyDevices).toBe('function');
        expect(typeof api.discoverHarmonyDevices).toBe('function');
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/unit/public_api.test.ts`
Expected: FAIL（`src/index.ts` 不存在）

- [ ] **Step 3: 改名并建入口**

`src/index.ts`：
```ts
export { HarmonyDevice } from './device/harmony/session';
export type { HarmonyObservation } from './device/harmony/session';
export type { HarmonySelector, HarmonyCandidate } from './device/harmony/selectors';
export { HarmonyDeviceError } from './device/harmony/errors';
export type { HarmonyDeviceErrorCode } from './device/harmony/errors';
export { doctorHarmonyDevices } from './device/harmony/doctor';
export type { HarmonyDoctorReport } from './device/harmony/doctor';
export { discoverHarmonyDevices } from './device/harmony/session';
export { Device } from './device/device';
export { Fuzz } from './runner/fuzz';
```

- [ ] **Step 4: 跑测试与构建**

Run: `npx vitest run && npm run build`
Expected: 全绿；`lib/index.js` 生成

- [ ] **Step 5: 提交**

```sh
git add -A
git commit -m "feat(api): expose HarmonyDevice as the package entry point"
```

---

### Task 3: 会话独占只靠文件租约

**Files:**
- Modify: `src/device/harmony/session.ts`（删 `const activeSerials = new Set<string>()` 与三处使用）
- Test: `test/unit/harmony_session.test.ts`

**Interfaces:**
- Consumes: `acquireDeviceLease(serial)` → `{ release(): void }`
- Produces: `connect()` 在租约冲突时抛 `HarmonyDeviceError('DEVICE_BUSY')`；`close()` 释放租约后可重连

- [ ] **Step 1: 写失败测试**

```ts
it('rejects a second connection while the lease is held, and allows reconnect after close', async () => {
    const held = new Set<string>();
    const fake = setup();
    fake.dependencies.acquireLease = (serial) => {
        if (held.has(serial)) throw new HarmonyDeviceError('DEVICE_BUSY', 'held');
        held.add(serial);
        return { release: () => { held.delete(serial); } };
    };
    const first = await HarmonyDevice.connect({ serial: online.serial }, fake.dependencies);
    await expect(HarmonyDevice.connect({ serial: online.serial }, fake.dependencies))
        .rejects.toMatchObject({ code: 'DEVICE_BUSY' });
    await first.close();
    const second = await HarmonyDevice.connect({ serial: online.serial }, fake.dependencies);
    await second.close();
});
```

- [ ] **Step 2: 确认失败**

Run: `npx vitest run test/unit/harmony_session.test.ts -t "lease is held"`
Expected: FAIL（第二个 connect 没抛错，因为 fake 未注入 lease 且模块级 Set 已先命中）

- [ ] **Step 3: 删除模块级 Set，租约失败时清理**

`connect()` 中 `activeSerials.add/delete` 全部删除；`acquireLease` 抛错时走既有 catch 分支（清理 tempDir/device 后原样抛出 `HarmonyDeviceError`）。

- [ ] **Step 4: 验证**

Run: `npx vitest run test/unit/harmony_session.test.ts && npx vitest run test/unit/device_lease.test.ts`
Expected: 全绿

- [ ] **Step 5: 提交**

```sh
git add -A
git commit -m "refactor(harmonyos): rely on the device lease for session ownership"
```

---

### Task 4: `apps()` 去猜测、`typeText` 去 verify

**Files:**
- Modify: `src/device/harmony/session.ts`
- Test: `test/unit/harmony_session.test.ts`

**Interfaces:**
- Produces: `findApps(query?: string): Array<{ bundleName: string; versionName?: string }>`；`typeText(text: string, options?: { allowNewlines?: boolean }): Promise<{ outcome: 'completed' }>`

- [ ] **Step 1: 写失败测试**

```ts
it('returns only bundle names and never guesses a localized label', async () => {
    const fake = setup([online], false, undefined, false, { bundleNames: ['com.taobao.taobao4hmos', 'com.huawei.hmos.settings'] });
    const session = await HarmonyDevice.connect({ serial: online.serial }, fake.dependencies);
    expect(session.findApps()).toEqual([{ bundleName: 'com.taobao.taobao4hmos' }, { bundleName: 'com.huawei.hmos.settings' }]);
    expect(session.findApps('淘宝')).toEqual([]);
    expect(session.findApps('settings')).toEqual([{ bundleName: 'com.huawei.hmos.settings' }]);
    await session.close();
});

it('does not accept a verify option on typeText', async () => {
    const fake = setup();
    const session = await HarmonyDevice.connect({ serial: online.serial }, fake.dependencies);
    await session.observe();
    const result = await session.typeText('hello');
    expect(result).toEqual({ outcome: 'completed' });
    await session.close();
});
```

- [ ] **Step 2: 确认失败**

Run: `npx vitest run test/unit/harmony_session.test.ts -t "guesses a localized label"`
Expected: FAIL（当前返回 `displayName: '淘宝'`）

- [ ] **Step 3: 删表与 verify**

删 `APP_DISPLAY_NAME_GUESSES`、`displayNameSource`、`getBundleInfo` 调用；`findApps` 只过滤 bundle 名。删 `expectedValue` 与 `verified` 分支。

- [ ] **Step 4: 验证**

Run: `npx vitest run && npm run build`
Expected: 全绿

- [ ] **Step 5: 提交**

```sh
git add -A
git commit -m "refactor(harmonyos): drop guessed app labels and unreliable input verification"
```

---

### Task 5: CLI 骨架 + `doctor`

**Files:**
- Create: `src/cli/harmony_command.ts`
- Modify: `src/cli/cli.ts`（在 commander 解析前拦截 `harmony` 子命令）
- Test: `test/unit/harmony_cli.test.ts`

**Interfaces:**
- Produces:
```ts
export interface CliResult { exitCode: number; stdout: string; stderr: string }
export interface HarmonyCliDeps {
    doctor(options: { serial?: string }): HarmonyDoctorReport;
    devices(): HdcTargetInfo[];
    connect(options: { serial?: string }): Promise<HarmonyDevice>;
}
export function runHarmonyCli(argv: string[], deps?: HarmonyCliDeps): Promise<CliResult>;
```
- `cli.ts` 顶部（commander 之前）：
```ts
if (process.argv[2] === 'harmony') {
    void runHarmonyCli(process.argv.slice(3)).then((result) => {
        process.stdout.write(result.stdout);
        process.stderr.write(result.stderr);
        process.exit(result.exitCode);
    });
    return;
}
```
（`cli.ts` 当前是 IIFE，改成在 IIFE 内提前 `return`。）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { runHarmonyCli } from '../../src/cli/harmony_command';
import { HarmonyDeviceError } from '../../src/device/harmony/errors';

const hdcMissing = {
    doctor: () => { throw new HarmonyDeviceError('HDC_UNAVAILABLE', 'HDC could not report its version.'); },
    devices: () => [],
    connect: async () => { throw new Error('unused'); },
};

describe('harmony cli', () => {
    it('explains how to install HDC and exits 3', async () => {
        const result = await runHarmonyCli(['doctor'], hdcMissing as never);
        expect(result.exitCode).toBe(3);
        expect(result.stderr).toContain('DevEco');
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, errorCode: 'HDC_UNAVAILABLE' });
    });

    it('exits 2 on an unknown command', async () => {
        const result = await runHarmonyCli(['bogus'], hdcMissing as never);
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain('usage');
    });
});
```

- [ ] **Step 2: 确认失败**

Run: `npx vitest run test/unit/harmony_cli.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`runHarmonyCli` 手写解析（不用 commander）：`argv[0]` 为命令名；`parseFlags(argv.slice(1))` 处理 `--serial <v>`、`--query <v>`、`--index <n>`、`--screenshot <file>`、`--expect-bundle <v>`、`--expect-sig <v>`、`--id/--text/--text-contains/--hint/--name <v>`、`--x/--y <n>`、`--from x,y`、`--to x,y`、`--speed <n>`、`--allow-newlines`。未知 flag → exit 2。`doctor` 的 `HDC_UNAVAILABLE` 映射到 exit 3 并输出 `HDC_HELP`（含 `DevEco`、`export PATH=`、`hdc version` 三行）。

- [ ] **Step 4: 验证**

Run: `npx vitest run test/unit/harmony_cli.test.ts && npm run build && node bin/haptest harmony doctor; echo "exit=$?"`
Expected: 测试绿；CLI 打印 DevEco 指引，`exit=3`

- [ ] **Step 5: 提交**

```sh
git add -A
git commit -m "feat(cli): add harmony command with actionable HDC diagnostics"
```

---

### Task 6: CLI 只读命令 `devices` / `observe` / `apps`

**Files:**
- Modify: `src/cli/harmony_command.ts`
- Test: `test/unit/harmony_cli.test.ts`

**Interfaces:**
- Produces: `devices` → `{ ok: true, devices: HdcTargetInfo[] }`；`observe` → `{ ok: true, observation: {...} }`；`apps` → `{ ok: true, apps: [{ bundleName }] }`

- [ ] **Step 1: 写失败测试（含锁屏）**

```ts
const lockedDevice = {
    serial: 'device-1',
    observe: async () => ({ observationId: 'o1', observedAt: 't', serial: 'device-1', width: 100, height: 200, coordinateSpace: 'physical-pixels', locked: true }),
    findApps: () => [],
    close: async () => {},
};

it('reports a locked device without a tree and exits 0', async () => {
    const result = await runHarmonyCli(['observe'], { ...hdcMissing, connect: async () => lockedDevice as never } as never);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.observation.locked).toBe(true);
    expect(parsed.observation.tree).toBeUndefined();
});

it('refuses actions on a locked device with exit 3', async () => {
    const result = await runHarmonyCli(['tap', '--text', 'Settings'], { ...hdcMissing, connect: async () => lockedDevice as never } as never);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('unlock');
});
```

- [ ] **Step 2: 确认失败**

Run: `npx vitest run test/unit/harmony_cli.test.ts`
Expected: FAIL（`observe` 未实现）

- [ ] **Step 3: 实现**

每个命令：`connect()` → 调 API → `close()`（`finally`）。`observe` 支持 `--screenshot <file>`：把 `observation.screenshot.data` 写入文件，JSON 里只留元数据。所有输出 `JSON.stringify` 一行。

- [ ] **Step 4: 验证**

Run: `npx vitest run test/unit/harmony_cli.test.ts && npm run build`
Expected: 全绿

- [ ] **Step 5: 提交**

```sh
git add -A
git commit -m "feat(cli): add harmony devices, observe and apps commands"
```

---

### Task 7: CLI 动作命令

**Files:**
- Modify: `src/cli/harmony_command.ts`
- Test: `test/unit/harmony_cli.test.ts`

**Interfaces:**
- Produces: `tap`/`type`/`key`/`swipe`/`launch`/`stop`；全部接受 `--expect-bundle` / `--expect-sig`，不匹配时 exit 3 且不动作

- [ ] **Step 1: 写失败测试**

```ts
it('rejects an ambiguous selector with candidates and exit 1', async () => {
    const device = { ...lockedDevice, observe: async () => unlocked(), find: () => [{ index: 0, text: 'OK' }, { index: 1, text: 'OK' }], tap: async () => { throw new HarmonyDeviceError('AMBIGUOUS_TARGET', 'multi', { candidates: [{ index: 0 }, { index: 1 }] }); }, close: async () => {} };
    const result = await runHarmonyCli(['tap', '--text', 'OK'], { ...hdcMissing, connect: async () => device as never } as never);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).details.candidates).toHaveLength(2);
});

it('refuses to act when --expect-sig does not match', async () => {
    const tapped: string[] = [];
    const device = { ...unlockedDevice(), tap: async () => { tapped.push('tap'); }, close: async () => {} };
    const result = await runHarmonyCli(['tap', '--text', 'OK', '--expect-sig', 'stale'], { ...hdcMissing, connect: async () => device as never } as never);
    expect(result.exitCode).toBe(3);
    expect(tapped).toEqual([]);
});
```

- [ ] **Step 2: 确认失败**

Run: `npx vitest run test/unit/harmony_cli.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

selector 参数合成 `HarmonySelector`；`--x/--y` 用本次 observe 的 `observationId`；`--expect-bundle`/`--expect-sig` 与本次 observe 比对，不匹配抛 `STALE_OBSERVATION` 并 exit 3。动作成功后**再 observe 一次**并把新 observation 打进 stdout。

- [ ] **Step 4: 验证**

Run: `npx vitest run && npm run build`
Expected: 全绿

- [ ] **Step 5: 提交**

```sh
git add -A
git commit -m "feat(cli): add harmony action commands with staleness guards"
```

---

### Task 8: `serve` JSON-lines 会话

**Files:**
- Create: `src/cli/harmony_serve.ts`
- Modify: `src/cli/harmony_command.ts`（`serve` 子命令委派）
- Test: `test/unit/harmony_serve.test.ts`

**Interfaces:**
- Produces:
```ts
export function runHarmonyServe(
    options: { serial?: string; input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream },
    deps?: Pick<HarmonyCliDeps, 'connect'>,
): Promise<void>;
```
请求 `{"id":1,"method":"observe","params":{}}`；响应 `{"id":1,"ok":true,"result":{...}}` 或 `{"id":1,"ok":false,"error":{code,message,nextStep}}`；`method:"close"` 关闭会话并结束。

- [ ] **Step 1: 写失败测试**

```ts
it('answers each line, survives bad input, and stops on close', async () => {
    const input = Readable.from([
        '{"id":1,"method":"observe","params":{}}\n',
        'not json\n',
        '{"id":2,"method":"nope","params":{}}\n',
        '{"id":3,"method":"close","params":{}}\n',
    ]);
    let out = '';
    const output = new Writable({ write(chunk, _enc, cb) { out += chunk.toString(); cb(); } });
    await runHarmonyServe({ input, output }, { connect: async () => fakeDevice() as never });
    const lines = out.trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ id: 1, ok: true });
    expect(lines[1]).toMatchObject({ ok: false });
    expect(lines[2]).toMatchObject({ id: 2, ok: false, error: { code: 'UNKNOWN_METHOD' } });
    expect(lines[3]).toMatchObject({ id: 3, ok: true });
});
```

- [ ] **Step 2: 确认失败**

Run: `npx vitest run test/unit/harmony_serve.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

逐行读取；每行 `JSON.parse` 失败 → `{ok:false,error:{code:'BAD_REQUEST'}}`（无 id 时 `id:null`）；未知 method → `UNKNOWN_METHOD`；method 与 API 同名（`observe/find/tap/swipe/type_text/press_key/apps/launch_app/stop_app`）；所有调用串行（`await` 链），保证 observation 语义。进程退出时 `close()` 会话。

- [ ] **Step 4: 验证**

Run: `npx vitest run && npm run build`
Expected: 全绿

- [ ] **Step 5: 提交**

```sh
git add -A
git commit -m "feat(cli): add stateful JSON-lines harmony serve mode"
```

---

### Task 9: 真机 E2E

**Files:**
- Create: `test/e2e/harness.ts`、`test/e2e/run.ts`、`test/e2e/tsconfig.json`
- Modify: `package.json`（`"e2e": "node -r ts-node/register/transpile-only test/e2e/run.ts"`）

**Interfaces:**
- Produces: `npm run e2e`；无 `HAPTEST_E2E_SERIAL` → 打印 `SKIPPED` 退出 0；有设备 → 每步 `PASS <name> <ms>` + 汇总表

- [ ] **Step 1: 写 harness 与流程**

`test/e2e/run.ts` 步骤：`connect` → `observe`（锁屏则失败并提示）→ `apps` → `launch_app(Settings)` → `observe` 校验前台 → `tap(SearchField by id，找不到则 SKIP)` → `press_key(BACK)` → `observe` → `close`。每步计时。

- [ ] **Step 2: 验证无设备路径**

Run: `npm run e2e; echo "exit=$?"`
Expected: 含 `SKIPPED`，`exit=0`

- [ ] **Step 3: 验证类型**

Run: `npx tsc --noEmit -p test/e2e/tsconfig.json`
Expected: exit 0

- [ ] **Step 4: 提交**

```sh
git add -A
git commit -m "test(e2e): add runnable real-device chain with per-step timings"
```

---

### Task 10: 文档收敛

**Files:**
- Create: `develop/harmonyos-device-api.md`
- Delete: `develop/harmonyos-replication-guide.md`、`develop/harmonyos-replication-handoff.md`、`develop/harmonyos-replication-handoff-template.md`、`develop/harmonyos-replica-commit-review.md`
- Modify: `README.md`（若提到 MCP/插件，改为 API + CLI 入口）

**Interfaces:**
- Consumes: Task 2–9 的最终 CLI 契约
- Produces: 一份 API/CLI 参考（命令、退出码、`serve` 协议、E2E 用法、已知限制）

- [ ] **Step 1: 写文档并删旧文档**

文档必须包含：安装前置（HDC/PATH）、`HarmonyDevice` 示例、全部 CLI 命令与退出码、`serve` 请求/响应示例、`npm run e2e` 判定、已知限制（无本地化名、锁屏启发式、输入框内容不可读）。

- [ ] **Step 2: 验证无 MCP 残留**

Run: `grep -rn "MCP\|codex plugin\|widget" README.md develop/ doc/ | grep -v harmonyos-device-api.md`
Expected: 无输出（或只剩历史审计文档里的描述性提及，需人工确认）

- [ ] **Step 3: 提交**

```sh
git add -A
git commit -m "docs(harmonyos): document the device API and CLI, drop MCP-era docs"
```
