# HapTest 性能观测：设计（第一版，A 路线）

> 日期：2026-11-01 · 基线 `feat/harmonyos-device-api`
> 数据源依据：`develop/deveco-perf-api.md`（接口手册）、`deveco-perf-protocol-messages.md`（协议全表）、`deveco-perf-sources.md`（逆向证据）
> 路线：**地基（步骤事件 + 时钟对齐 + 环境快照）→ 嵌入式采集库 → 事后报告 → 实时 UI 后置**

## 1. 意图

自动化测试（随机 / 脚本 / GUI agent）跑的时候，能回答一个问题：

> **第 37 步那次滑动，掉了多少帧？为什么？**

不是"跑的时候有几条曲线"，而是"每个步骤有自己的性能数字，且这些数字能和代码/动作对上"。实时仪表盘是这条链路的展示层，不是起点。

## 2. 目标 / 非目标 / 反目标

**目标（第一版）**

1. 三种驱动（fuzz policy / CLI 脚本 / `serve` agent）通过同一个 `StepSink` 上报步骤边界。
2. 步骤时间与设备时钟对齐，误差可量化（报告里给出对齐残差）。
3. 每次 run 落一份 `RunContext`（设备、刷新率、亮度、前后台、trace 覆盖情况）。
4. 事后产出 `report.json` + 自包含 `report.html`：逐步的帧/CPU/内存 + 异常列表 + **缺失数据说明**。
5. 分析层能用**合成 SQLite fixture** 做真测试（schema 已知，不需要真机）。

**非目标（第一版）**

- 实时 UI（WebSocket 仪表盘）——第二版。
- GPU / 功耗 / 网络 / JS 堆分析——数据表已在 schema 里，先不接。
- 多设备并发、基线库（跨 run 中位数）、自动归因。

**反目标**

- 报告里出现没有来源的数字（每个数必须带 `source`）。
- 缺数据时填 0 或省略行——必须显式 `missing: [{metric, reason}]`。
- 先做 UI 再补对齐（曲线对不上步骤 = 贵一点的 `top`）。

## 3. 约束

- **没有真机**：`hdc` 不在 PATH。设备侧命令、`hiprofiler` 可用性、`flag` 语义都未验证。
- 但 `trace_streamer` 的 92 张表 schema 已实测（喂空表头 trace 即可建库），**分析层可以脱离设备开发与测试**。
- 一次 trace 几十 MB；小时级运行需要分段与清理。
- `hitrace` 的时钟是 boottime ns；host 是 wall clock ms。

## 4. 方案

### 4.1 为什么是 A 而不是 B/C

- **B（常驻 host + 实时仪表盘）**：需要先有步骤事件与对齐，否则曲线无法归属；且实时 gRPC 要复刻 protobuf 会话，成本最高。放到第二版。
- **C（只做实时最小闭环）**：看起来最快，但产出的是"三条漂亮曲线 + 说不出第 37 步为什么卡"。
- **A**：地基一次做对，采集器可替换（离线 trace 先上，实时 gRPC 后插同一个接口），报告层与数据源解耦。

### 4.2 三层

```
驱动层（fuzz / CLI / serve）
   │  StepSink.emit(StepEvent)
   ▼
采集层  PerfCollector（TraceCollector 现在 / GrpcCollector 以后）
   │  RunArtifacts{context, steps[], tracePath?, dbPath?}
   ▼
分析层  analyze(artifacts) → RunReport
   │
   ▼
报告层  report.json / report.html
```

### 4.3 核心类型

```ts
export interface StepEvent {
    runId: string;
    stepId: number;                 // 单调递增
    kind: 'action' | 'observe' | 'launch' | 'stop' | 'marker';
    name: string;                   // 'tap:搜索' / 'swipe:feed' / 'launch:com.x'
    hostStartedAt: number;          // epoch ms
    hostEndedAt?: number;
    deviceStartedNs?: number;       // boottime ns，对齐后写入
    deviceEndedNs?: number;
    observationId?: string;
    bundleName?: string;
    outcome: 'completed' | 'failed' | 'skipped';
    errorCode?: string;
}

export interface StepSink { emit(event: StepEvent): void }

export interface RunContext {
    runId: string;
    startedAt: string;
    device: { serial: string; model?: string; osVersion?: string; refreshRate?: number };
    env: { brightness?: number; wifi?: boolean; bt?: boolean; foregroundBundle?: string; battery?: number; temperatureC?: number };
    driver: 'fuzz' | 'cli' | 'agent';
    clock: { hostToDeviceOffsetMs: number; residualMs: number; source: 'rtt' | 'clock_snapshot' | 'none' };
    coverage: { trace: boolean; plugins: string[] };
}

export interface PerfCollector {
    start(): Promise<void>;
    step(event: StepEvent): void;
    stop(): Promise<RunArtifacts>;
}

export interface RunArtifacts {
    context: RunContext;
    steps: StepEvent[];
    tracePath?: string;
    dbPath?: string;
}
```

### 4.4 时钟对齐（两个独立来源，都记下来）

1. **RTT 采样**：连续 K 次（默认 5）执行 `hdc shell date +%s%N`，取 RTT 最小的一次算 `offset = deviceWall - (hostBefore+hostAfter)/2`，`residual = RTT/2`。
2. **`clock_snapshot`**：trace 落库后读 `clock_snapshot(clock_id, ts, clock_name)` 与 `datasource_clockid`，把 boottime ns 换成 wall clock。
3. 报告里同时给两个来源；优先 `clock_snapshot`（设备自己记的映射），`rtt` 作为交叉校验。两者差 > 200ms 时在报告里标 `clock_mismatch`。

### 4.5 采集器（第一版只有 TraceCollector）

```
start():
  hitrace --trace_begin graphic ability app          # 类别来自 DevEco 默认，可配置
  record RunContext
step(e): 内存里记 e（写 steps.jsonl）
stop():
  hitrace --trace_finish -o /data/local/tmp/trace_<runId>.htrace
  hdc file recv → <out>/runs/<runId>/trace.htrace
  trace_streamer trace.htrace -e trace.db            # 本地二进制，路径可配
  读 clock_snapshot 做对齐，回填 steps[].deviceStartedNs
  → RunArtifacts
```

`trace_streamer` 找不到时：`coverage.trace=false`，报告仍生成，但所有性能指标进 `missing`，并说明"本机缺少 trace_streamer"。

### 4.6 分析层（纯 SQL + 纯函数，可测）

按 `step.deviceStartedNs ~ deviceEndedNs` 窗口查：

```sql
-- 帧
SELECT frame_no, ts, dur, flag, type_desc
FROM frame_slice
WHERE ipid = :pid AND ts BETWEEN :start AND :end;

-- FPS（hidump-plugin 通路才有；离线 trace 里通常为空）
SELECT ts, fps FROM hidump WHERE ts BETWEEN :start AND :end;

-- 冷启动分段（launch 步骤）
SELECT start_name, start_time, end_time FROM app_startup WHERE ipid = :pid;
```

`ipid` 由 `process` 表按 bundle 名解析（`process.name`）；解析不到时该步骤 `missing: [{metric:'frames', reason:'process-not-found'}]`。

输出：

```ts
export interface StepMetrics {
    stepId: number;
    name: string;
    window: { startNs: number; endNs: number };
    frames?: { total: number; jank: number; maxMs: number; p95Ms: number; budgetMs: number };
    cpu?: { avgLoad: number; peakLoad: number };
    memory?: { startRssKb: number; endRssKb: number; deltaKb: number };
    startup?: { phases: Array<{ name: string; ms: number }> };
    missing: Array<{ metric: string; reason: string }>;
}

export interface RunReport {
    context: RunContext;
    steps: StepMetrics[];
    anomalies: Array<{ stepId: number; rule: string; detail: string; severity: 'info' | 'warn' | 'critical' }>;
    summary: { steps: number; withFrames: number; jankSteps: number; durationMs: number };
}
```

**最小规则集（阈值写成数据，不写死在代码里）**

| 规则 | 判据 | 严重度 |
| --- | --- | --- |
| `JANK_RATE` | `jank/total > 0.05` | warn |
| `FRAME_SPIKE` | `maxMs > 2 × budgetMs` | critical |
| `MEMORY_GROWTH` | 相邻步骤 RSS 增量 > 20MB 且持续 ≥3 步 | warn |
| `CPU_SATURATION` | `avgLoad > 0.9` 且窗口 > 5s | warn |
| `STARTUP_SLOW` | 任一阶段 > 1500ms | info |

`budgetMs = 1000 / refreshRate`（来自 `device_info.physical_frame_rate`，缺省 60Hz）。

### 4.7 报告

- `report.json`：`RunReport` 原样。
- `report.html`：单文件、内联 SVG/CSS、无外部依赖（离线可看）。内容：RunContext 表 → 步骤表（每步一行：帧数/jank/最长帧/CPU/内存/缺失）→ 异常列表 → 对齐残差。
- `out/runs/<runId>/`：`context.json`、`steps.jsonl`、`trace.htrace`、`trace.db`、`report.json`、`report.html`。
- 保留策略：默认保留最近 10 次，trace/db 超过 3 天的删（报告留着）。

### 4.8 三种驱动的接入点

| 驱动 | 接入点 | 做法 |
| --- | --- | --- |
| fuzz | `EventAction` 执行前后 | 包一层 `sink.emit` |
| CLI 脚本 | `harmony_command.ts` 的 `withDevice` | 每个命令一次 `action` 事件 |
| agent | `harmony_serve.ts` 的 `handle` | 每个 method 一次事件；`observe` 记 `kind:'observe'` |

三者共用 `RunId` + `StepSink`，由 `haptest perf run` 注入。

## 5. 我的判断（可推翻）

| # | 决定 | 理由 |
| --- | --- | --- |
| D1 | 第一版只做 TraceCollector，不做 gRPC | 离线能覆盖全部指标；gRPC 的增量只有实时性 |
| D2 | 报告用自包含 HTML，不用前端框架 | 无构建、可邮件发、可进论文附录 |
| D3 | 阈值写成 `rules.json` 数据 | 阈值会随设备/App 变，改数据不改码 |
| D4 | `missing` 是必填字段 | 缺数据必须可见，这是上一轮翻车的教训 |
| D5 | 用合成 SQLite fixture 测分析层 | schema 已知，不需要真机也能写真测试 |
| D6 | 不对多设备做预留抽象 | 现在没有第二个消费者，YAGNI |
| D7 | 报告不做"分数/评级" | 没有基线就没有分数，编一个只会误导 |

## 6. 验收

| # | 验收 | 命令 | 期望 |
| --- | --- | --- | --- |
| A1 | 构建与单测 | `npm run build && npm test -- --run` | 全绿 |
| A2 | 分析层可测 | `npx vitest run test/unit/perf_analyze.test.ts` | 用合成 db 断言 jank/缺失/异常 |
| A3 | 无设备时降级 | `haptest perf run -- echo hi` | 生成 report，`coverage.trace=false`，指标全在 `missing` |
| A4 | 报告自包含 | 打开 `report.html` | 断网可看，无外部请求 |
| A5 | 对齐可量化 | report 里 `clock.residualMs` | 有值且 < 100ms 时才算对齐 |
| A6 | 有设备 | 同上，接真机 | `coverage.trace=true`，至少一个步骤有 `frames.total>0` |

## 7. 留给实现者

- `src/perf/` 新目录：`step.ts`、`context.ts`、`collector/trace.ts`、`align.ts`、`analyze.ts`、`report/html.ts`、`rules.json`。
- `trace_streamer` 路径按 `REA` 同款思路可配：`HAPTEST_TRACE_STREAMER` 环境变量优先，其次 DevEco 默认路径，都找不到就降级。
- 合成 fixture：用 `sqlite3` 建 `frame_slice`/`process`/`clock_snapshot`/`device_info` 四张表即可覆盖分析层。
- 第一步不是写 collector，是写 `StepEvent` + 三种驱动的埋点 + 一个只打印事件的 sink —— 这一步不依赖设备，且决定后面所有事。
