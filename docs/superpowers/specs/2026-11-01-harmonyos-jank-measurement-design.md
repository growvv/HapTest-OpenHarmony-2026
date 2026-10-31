# HarmonyOS 掉帧测量：设计

> 日期：2026-11-01 · 基线 `feat/harmonyos-device-api`
> 前置：`docs/superpowers/specs/2026-11-01-harmonyos-device-api-design.md`（API/CLI 已落地）
> 目标问题：列表/Feed 场景滑动时的帧率与掉帧

## 1. 意图与理由

当前 `HarmonyDevice` 是"遥控器"：能 observe/tap/swipe，但拿不到任何性能数。第一个 agent 实验要回答的是**"这次滑动掉了多少帧"**，所以需要一层最小的测量面。

HapTest 底座现有的"性能"只有两块，都不能回答这个问题：

- `Hdc.hiperfRecord()` + `perf_report.ts`：采样 3s+，回答"CPU 热点在哪"，不回答"这次滑动多慢"。
- `collectFaultLogger()`：回答"崩没崩"。

## 2. 目标 / 非目标 / 反目标

**目标**

1. `device.probeMetrics()`：报告这台设备上哪些帧率来源**真的可用**，附原始输出。
2. `device.trace(action)`：包住一次动作，返回 `{durationMs, frames}`。
3. CLI `haptest harmony probe`、`haptest harmony swipe --measure`；`serve` 的 `swipe` 支持 `measure:true`。
4. 拿不到帧率时**明确报 `UNSUPPORTED_METRIC` 并退出 3**，绝不返回编造的数字。

**非目标**

- 内存、CPU、功耗、启动耗时、GPU。
- jank 归因（哪一帧、哪个组件慢）——那是后续 RQ。
- SmartPerf Host 集成、图表、时间线可视化。

**反目标（"跑起来了"也算失败）**

- 用截图差异/UI 树变化频率冒充 fps。
- 探测失败时静默返回 `fps: 0` 或 `avgFps: 60`。
- 把 `sp_daemon` 之类未验证的命令硬编码进解析器。

## 3. 约束

- **没有真机**：`hdc` 不在 PATH，JUY-AL50 不在手边。任何解析器都不能凭空写。
- 候选来源的命令与输出格式均未在本机验证：`sp_daemon`、`GP_daemon_fps`、`hidumper -s RenderService`、`hilog`。商业 HarmonyOS 手机上 `sp_daemon` 很可能不存在。
- 采样必须与动作**同进程**：帧率采集要覆盖动作窗口，跨进程 CLI 做不到。

## 4. 方案：探测优先的级联降级

```
probeMetrics()
  ├─ sp_daemon        (可用 → source='sp_daemon',     confidence='measured')
  ├─ GP_daemon_fps    (可用 → source='gp_daemon_fps', confidence='measured')
  ├─ hidumper RenderService (可解析 → source='hidumper', confidence='measured')
  └─ 都不可用         → supported=false，trace() 抛 UNSUPPORTED_METRIC
```

**为什么没有第二个方案可选**：帧率只有设备侧能给出。截图差异是代理指标且成本极高，hiperf 是另一个问题（热点 ≠ 帧率）。所以设计问题不是"选哪条路"，而是"探测不到时怎么诚实地失败"。

### 4.1 接口

```ts
export interface FrameSample {
    source: 'sp_daemon' | 'gp_daemon_fps' | 'hidumper';
    fpsSeries: number[];      // 每秒一个采样
    avgFps: number;
    minFps: number;
    slowSeconds: number;      // fps < jankThreshold 的秒数
    jankFrames?: number;      // 仅当来源直接给出掉帧数
    jankThreshold: number;    // 默认 55
}

export interface ActionTrace {
    action: string;
    durationMs: number;
    frames?: FrameSample;
}

export interface MetricProbe {
    frames: {
        supported: boolean;
        source?: FrameSample['source'];
        raw: string;          // 探测命令的原始输出，便于人工核对
        reason?: string;      // supported=false 时说明尝试过什么
    };
}

// HarmonyDevice 新增
probeMetrics(): Promise<MetricProbe>;
trace<T>(action: string, run: () => Promise<T>): Promise<{ result: T; trace: ActionTrace }>;
```

`FrameSource` 是内部接口，一个来源一个实现：

```ts
interface FrameSource {
    name: FrameSample['source'];
    probe(hdc: Hdc): boolean;          // 命令存在且输出可识别
    start(hdc: Hdc): void;             // 开始采集
    stop(hdc: Hdc): FrameSample;       // 停止并解析
}
```

### 4.2 CLI / serve

```sh
haptest harmony probe                     # {ok:true, metrics:{frames:{supported,source,raw}}}
haptest harmony swipe --from x,y --to x,y --measure
                                          # result 里多一个 trace: {durationMs, frames}
```

`serve`：`{"method":"swipe","params":{...,"measure":true}}`。

探测不到帧率时 `--measure` 输出 `{ok:false, errorCode:'UNSUPPORTED_METRIC', details:{tried:[...]}}`，退出 3。

### 4.3 这轮能交付什么（没有设备）

| 交付 | 现在能做 | 依赖真机 |
| --- | --- | --- |
| `probeMetrics()` + `haptest harmony probe` | ✅ | — |
| `FrameSource` 接口 + 注册表 + 降级链 | ✅ | — |
| `trace()` + `--measure` 管线 + `UNSUPPORTED_METRIC` 语义 | ✅ | — |
| 具体来源的 `probe()`/`stop()` 解析器 | ❌ | ✅ 必须先拿到真机原始输出 |
| `FrameSample` 的数值正确性 | ❌ | ✅ |

解析器**先不写**。真机第一次跑 `probe` 时把 `raw` 贴进 `develop/harmonyos-jank.md`，再照着那份输出写解析器——这是本设计里唯一的硬顺序。

## 5. 验收

| # | 验收 | 命令 | 期望 |
| --- | --- | --- | --- |
| A1 | 构建与单测 | `npm run build && npm test -- --run` | 全绿 |
| A2 | 无设备时 probe 不撒谎 | `haptest harmony probe` | `supported:false` + `reason` + 原始输出，exit 3 |
| A3 | 无设备时 measure 明确失败 | `haptest harmony swipe --from 1,2 --to 3,4 --measure` | `UNSUPPORTED_METRIC`，exit 3 |
| A4 | 不编造 | `grep -rn "avgFps" src/` | 只有解析器写入，没有默认值兜底 |
| A5 | 有设备时 | `probe` | 输出 `supported:true` + `source` + `raw`，`raw` 能对上真实命令输出 |

## 6. 我的判断（可推翻）

| # | 决定 | 理由 |
| --- | --- | --- |
| D1 | **只做 `swipe --measure`，不做 `scroll`/`fling` 专用命令** | 滑动手势是唯一能稳定复现 Feed 场景的入口；`fling` 已有但语义不同 |
| D2 | **`jankThreshold` 默认 55** | 60Hz 下 55 是可解释的宽松线；120Hz 设备要另算，写进文档 |
| D3 | **`trace()` 返回原始结果 + trace，不吞动作返回值** | 调用方需要知道动作本身是否成功 |
| D4 | **探测结果不缓存** | 换设备/换系统版本时缓存会骗人；探测本身是一次 shell 往返 |
| D5 | **解析器缺失时不注册该来源** | 宁可 `supported:false`，不要半残的 source |

## 7. 留给实现者
- 候选命令清单集中在 `src/device/harmony/metrics/sources/`，一个文件一个来源。
- `probe` 的 `raw` 必须原样保留（截断到 4KB），它是后续写解析器的唯一依据。
- 采样窗口至少覆盖 `swipe` 前 300ms 到后 1s，否则首帧掉了也看不见。
- 若设备是 120Hz，`fpsSeries` 的基线不是 60，`slowSeconds` 的阈值需要按刷新率缩放——在 probe 里读一次刷新率。
