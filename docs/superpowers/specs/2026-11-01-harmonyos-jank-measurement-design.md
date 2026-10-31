# HarmonyOS 掉帧测量：设计（v2，基于 DevEco 逆向）

> 日期：2026-11-01 · 基线 `feat/harmonyos-device-api`
> 证据：`develop/deveco-perf-sources.md`（DevEco 逆向结论）、`develop/deveco-perf-api.md`（接口/参数手册）
> 目标问题：列表/Feed 场景滑动时的帧率与掉帧

## 1. 意图与理由

`HarmonyDevice` 目前是"遥控器"：能 observe/tap/swipe，但拿不到任何性能数。第一个 agent 实验要回答"这次滑动掉了多少帧"。

DevEco 的逆向结论改变了做法：**它不用 shell 采样 fps，而是用 trace 解析逐帧切片**。`ftrace-plugin` 出 `.htrace`，本地 `trace_streamer` 解析成 SQLite，帧数据长这样：

```
FrameRelatePo        { frameNo, vsync, processId, processName, startTime, duration, depth, jankFlag }
FrameTotalStatisticsPo { processId, processName, jankFlag, duration }
```

所以"掉帧"的正确定义是 **vsync 对齐的帧切片 + jankFlag**，不是"fps 低于阈值算一次"。v1 设计里那个 `slowSeconds = fps < 55` 的代理算法作废。

## 2. 目标 / 非目标 / 反目标

**目标**

1. `device.probeMetrics()`：报告这台设备上哪些帧数据来源真的可用，附原始输出。
2. `device.trace(action, run)`：包住一次动作，返回 `{durationMs, frames}`，`frames` 含逐帧 `duration` 与 `jankFlag`。
3. CLI `haptest harmony probe`、`haptest harmony swipe … --measure`；`serve` 的 `swipe` 支持 `measure:true`。
4. 拿不到帧数据时明确报 `UNSUPPORTED_METRIC` 并退出 3，绝不返回编造的数字。

**非目标**

- 内存、CPU、功耗、GPU、网络（DevEco 有 `memory-plugin`/`cpu-plugin`/`xpower-plugin`/`network-plugin`，以后按同一套 probe 结构加）。
- jank 归因（哪一帧、哪个组件、哪条规则触发）——那是 `hos-performance-diagnosis` 那种 792 类规则引擎的活，属后续 RQ。
- 复刻 DevEco 的 gRPC 会话（见 §4 路径 B）。

**反目标**

- 用截图差异/UI 树变化频率冒充 fps。
- 把"每秒 fps 采样"当成"逐帧掉帧"来报。
- 探测失败时返回 `fps: 0` / `jankFrames: 0`。

## 3. 约束

- **没有真机**：`hdc` 不在 PATH，JUY-AL50 不在手边。所有设备侧命令与输出格式均未验证。
- `trace_streamer` 已实测可运行（本地 macOS 二进制，需 `DYLD_LIBRARY_PATH=.../dic_server/lib`），但它接受的 trace 内容是否包含帧切片未验证。
- 采样必须与动作**同进程**：trace 的起止要包住动作窗口，跨进程 CLI 做不到。
- 商业 HarmonyOS（非 OpenHarmony）上 `hiprofiler_cmd` / `hiprofiler_plugins` 是否存在未知；`sp_daemon` 大概率不存在。

## 4. 方案：trace 优先，gRPC 留后

```
probeMetrics()
  ├─ A. hitrace + 本地 trace_streamer   ← 首选：系统自带命令 + 现成二进制
  ├─ B. hidump-plugin over gRPC         ← 保真度最高，但要复刻 DevEco 会话
  └─ 都不可用 → supported=false，trace() 抛 UNSUPPORTED_METRIC
```

**为什么 A 优先**：`hitrace` 是系统命令，`trace_streamer` 已经躺在 DevEco 里且实测能跑；B 需要 protobuf schema、端口转发、daemon 生命周期、会话状态机，成本高一个数量级，而它多给的只是"实时 fps 流"。

**为什么没有 C（sp_daemon）**：开发板工具，商业机不存在；把它写进降级链只会让 probe 多一次必然失败。

### 4.1 接口

```ts
export interface FrameStat {
    frameNo: number;
    vsync?: number;
    ts: number;             // ns, frame_slice.ts
    dur: number;            // ns, frame_slice.dur
    flag: number;           // frame_slice.flag，jank 语义待真机确认
    typeDesc?: string;      // frame_slice.type_desc
}

export interface FrameSample {
    source: 'htrace' | 'hidump_plugin';
    frames: FrameStat[];
    totalFrames: number;
    jankFrames: number;
    maxFrameMs: number;
    p95FrameMs: number;
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
        raw: string;        // 探测命令的原始输出（截断 4KB）
        reason?: string;    // supported=false 时说明尝试过什么
    };
}

// HarmonyDevice 新增
probeMetrics(): Promise<MetricProbe>;
trace<T>(action: string, run: () => Promise<T>): Promise<{ result: T; trace: ActionTrace }>;
```

内部 `FrameSource`，一个来源一个实现：

```ts
interface FrameSource {
    name: FrameSample['source'];
    probe(hdc: Hdc): boolean;
    start(hdc: Hdc): Promise<void>;
    stop(hdc: Hdc): Promise<FrameSample>;
}
```

`htrace` 源的三步：`hitrace --trace_begin graphic ability app` → 动作 → `hitrace --trace_finish -o <path>` → `hdc file recv` → 本地 `trace_streamer -e out.db` → SQL 查帧表。**trace_streamer 的路径来自 DevEco 安装目录，不在 PATH**，所以 probe 要同时检查二进制存在性；找不到就退化成"只交 trace 文件，不解析"（`source:'htrace'` 但 `frames` 为空 + `reason`）。

### 4.2 CLI / serve

```sh
haptest harmony probe                              # {ok:true, metrics:{frames:{supported,source,raw}}}
haptest harmony swipe --from x,y --to x,y --measure  # result 里多一个 trace
```

`serve`：`{"method":"swipe","params":{...,"measure":true}}`。

拿不到帧数据时 `--measure` 输出 `{ok:false, errorCode:'UNSUPPORTED_METRIC', details:{tried:[...]}}`，退出 3。

### 4.3 这轮能交付什么（没有设备）

| 交付 | 现在能做 | 依赖真机 |
| --- | --- | --- |
| `probeMetrics()` + `haptest harmony probe`（含 trace_streamer 定位） | ✅ | — |
| `FrameSource` 接口 + 注册表 + 降级链 | ✅ | — |
| `trace()` + `--measure` 管线 + `UNSUPPORTED_METRIC` 语义 | ✅ | — |
| htrace 源的命令拼接与文件搬运 | ✅（命令来自 DevEco 常量） | 验证 |
| trace → SQLite 的帧表查询 | ✅（schema 已实测，见下） | 验证行内容 |
| 数值正确性 | ❌ | ✅ |

`trace_streamer` 建库 schema 已经实测拿到（喂空表头 trace 即可），`frame_slice` 的列是固定的：

```sql
CREATE TABLE frame_slice(
  id INT, ts INT, vsync INT, ipid INT, itid INT, callstack_id INT,
  dur INT, src TEXT, dst INT, type INT, type_desc TEXT, flag INT,
  depth INT, frame_no INT
);
CREATE TABLE hidump(id INT, ts INT, fps INT);
```

所以查询可以直接写：

```sql
SELECT frame_no, vsync, ts, dur, flag, type_desc, ipid
FROM frame_slice
WHERE ipid = ?          -- 目标进程
  AND ts BETWEEN ? AND ?  -- 动作窗口
ORDER BY ts;
```

**仍然未知的只有枚举值**：`flag` 取什么值代表 jank、`type_desc` 的字符串集合（`data_type` 表要真实 trace 才填）。真机第一次跑完，把 `SELECT DISTINCT flag, type_desc FROM frame_slice` 贴进 `develop/harmonyos-jank.md`，映射表就定了——这是本设计唯一的硬顺序。


## 5. 验收

| # | 验收 | 命令 | 期望 |
| --- | --- | --- | --- |
| A1 | 构建与单测 | `npm run build && npm test -- --run` | 全绿 |
| A2 | 无设备时 probe 不撒谎 | `haptest harmony probe` | `supported:false` + `reason` + `raw`，exit 3 |
| A3 | 无设备时 measure 明确失败 | `haptest harmony swipe --from 1,2 --to 3,4 --measure` | `UNSUPPORTED_METRIC`，exit 3 |
| A4 | 不编造 | `grep -rn "jankFrames" src/` | 只由解析器写入，无默认值兜底 |
| A5 | 有设备时 | `probe` + `swipe --measure` | `supported:true`，`frames.jankFrames` 与 DevEco Profiler 同一手势的读数同量级 |

## 6. 我的判断（可推翻）

| # | 决定 | 理由 |
| --- | --- | --- |
| D1 | **只做 `swipe --measure`** | 滑动手势是唯一能稳定复现 Feed 场景的入口 |
| D2 | **掉帧用 `jankFlag`，不用 fps 阈值** | DevEco 的帧模型就是这么定的；fps 阈值是代理指标 |
| D3 | **`trace()` 不吞动作返回值** | 调用方需要知道动作本身是否成功 |
| D4 | **探测结果不缓存** | 换设备/换版本时缓存会骗人 |
| D5 | **trace_streamer 缺失时降级为"只交 trace 文件"** | 解析器是本机资产，不该让设备侧能力被它绑架 |
| D6 | **不实现 gRPC 路径** | 成本高一个数量级，收益只是实时 fps 流 |

## 7. 留给实现者

- 来源实现放 `src/device/harmony/metrics/sources/`，一个来源一个文件。
- `probe` 的 `raw` 原样保留（截断 4KB），它是写解析器的唯一依据。
- 采样窗口：`--trace_begin` 要在 `swipe` 前 ≥300ms，`--trace_finish` 在后 ≥1s，否则首帧掉了也看不见。
- trace 文件较大（数十 MB），落盘到会话临时目录并在 `close()` 时清理。
- 120Hz 设备：`duration` 判据不变，但 `p95FrameMs` 的基线要按刷新率解释，probe 里读一次刷新率。
