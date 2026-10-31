# DevEco Studio 的性能数据是怎么采的（逆向笔记）

> **接口/参数手册见 [`deveco-perf-api.md`](deveco-perf-api.md)**；本文只记逆向过程、证据与结论。
> 日期：2026-11-01 · 对象：`/Applications/DevEco-Studio.app` 26.0.0.865
> 目的：给 HapTest 的掉帧/性能测量找一条**已被大厂验证过**的数据通路，而不是自己猜命令。

## 1. 怎么逆的（可复现）

```sh
cd /Applications/DevEco-Studio.app/Contents/plugins
ls                       # ohos-profiler / performanceTesting / ohos-trace / diagnostic-plugin / hos-performance-diagnosis
unzip -l ohos-profiler/lib/ohos-profiler-26.0.0.865.jar | grep -i 'grpc/plugin'
# 逐个 .class 抽可打印字符串，找命令模板与 protobuf 字段
```

关键 jar：`ohos-profiler-26.0.0.865.jar`（协议 + 插件配置）、`instrumented-profiler-foundation-common`（常量与命令）、`hos-performance-diagnosis`（792 类诊断引擎）、`xtester-oh-performance`（XTest 侧同一套 gRPC）。

## 2. 架构：不是"调一条 shell 命令"，是 gRPC 会话

```
DevEco (JVM)                         设备
  HiProfilerManager
    ├─ hdc fport <local> <device:port>      ← 端口转发
    ├─ hiprofiler_cmd -s                    ← 拉起 daemon
    ├─ gRPC: CreateSession/StartSession     ┐
    │        FetchData / KeepSession        ├─ hiprofilerd
    │        StopSession/DestroySession     ┘   └─ hiprofiler_plugins
    └─ hiprofiler_cmd -k                    ← 收尾
```

证据（字符串常量，均来自 `CmdConstants` / `OpenHarmonyDevice` / `HiProfilerManager`）：

| 常量 | 值 |
| --- | --- |
| 启动 | `hiprofiler_cmd -s` |
| 停止 | `hiprofiler_cmd -k` |
| 设备进程 | `hiprofilerd`、`hiprofiler_plugins`、`native_daemon` |
| 端口转发 | `fport %s %s` / `fport rm %s %s` |
| 能力探测 | `pidof hiprofiler_plugins` |
| trace 文件 | `/data/local/tmp/trace_%s.htrace` |
| 一次性 dump | `hidumper -s WindowManagerService -a -a`、`hidumper -s AbilityManagerService -a -a` |
| 简单 trace | `hitrace --trace_begin ability app` … `hitrace --trace_finish -o` |

## 3. 采集面：7 个 plugin

`PluginConfigurator` 家族，插件名是设备侧字面量：

| plugin | 采什么 | 关键配置 |
| --- | --- | --- |
| `hidump-plugin` | **FPS 采样序列** | `HidumpPluginConfig{ report_fps: true }` |
| `ftrace-plugin` | **trace（帧/调度/频率）** | `TracePluginConfig{ hitraceCategories, ftraceEvents, bufferSizeKb, clock, tracePeriodMs }` |
| `cpu-plugin` | CPU 使用/调用栈 | — |
| `memory-plugin` | 内存 | — |
| `gpu-plugin` | GPU | — |
| `xpower-plugin` | 功耗 | — |
| `network-plugin` | 网络 | — |

默认 ftrace 事件（`HiprofilerService` 字面量）：`sched/sched_switch`、`sched/sched_wakeup`、`sched/sched_wakeup_new`、`sched/sched_waking`、`sched/sched_process_exit`、`sched/sched_process_free`、`power/cpu_frequency`、`power/cpu_idle`。

**这条最重要**：DevEco 的 FPS 和 jank 是**两条独立通路**——
- FPS：`hidump-plugin` 持续上报 `FpsData`；
- jank：`ftrace-plugin` 出 trace，本地解析成**逐帧切片**。

## 4. 数据模型（protobuf / PO 字段名即规格）

```
FpsData            { id, fps, time{ ClockId, ... } }              // 一串 fps 采样点
FrameRelatePo      { frameNo, vsync, processId, processName,
                     startTime, duration, depth, jankFlag }        // 逐帧
FrameTotalStatisticsPo { processId, processName, jankFlag, duration }  // 按进程汇总
```

即：**jank 判定是"vsync 对齐的帧切片 duration + jankFlag"**，不是"fps 低于阈值算一次掉帧"。我们之前设计里那个 `slowSeconds = fps < 55` 的代理算法，精度上差一档。

## 5. 本地还有个大杀器：`trace_streamer`

```
/Applications/DevEco-Studio.app/Contents/tools/profiler/dic_server/trace_streamer
```

实测（必须带 `DYLD_LIBRARY_PATH`，否则 `libc++.1.dylib` 找不到）：

```sh
cd /Applications/DevEco-Studio.app/Contents/tools/profiler/dic_server
DYLD_LIBRARY_PATH="$PWD/lib" ./trace_streamer --list
```

输出：

```
support: hiperf, ebpf, native_hook, hilog, hisysevent, arkts,
         bytrace, rawtrace, htrace, ffrt, memory, hidump, cpudata, network, diskio, process
```

用法：

```sh
DYLD_LIBRARY_PATH=./lib ./trace_streamer trace.htrace -e out.db    # → SQLite
DYLD_LIBRARY_PATH=./lib ./trace_streamer trace.htrace -c           # 命令行模式
DYLD_LIBRARY_PATH=./lib ./trace_streamer trace.htrace -m <metrics> # 按指标查询
```

也就是说：**trace → SQLite → 我们自己写 SQL**。不需要 gRPC、不需要 protobuf、不需要 daemon 生命周期。

## 6. 诊断引擎：792 个类

`hos-performance-diagnosis` 不是采集器，是**规则诊断层**：`StaticRulePo`（阈值）、`*ImpactCalculator`（影响度）、`*Report`（报告）、`AdviceFactory`（建议）、`Guidance`（引导）。家族包括：

`ColdStartPhaseResult`（冷启动分段）、`AsyncBlock*`（主线程阻塞）、`WeakNetwork*`（弱网）、`BigTextureUtil`（大图）、`CostTime*`（耗时函数）、`VideoStartPo`（视频起播）、`NetworkMetricEnum`。

对我们的意义：**"PerfRootCause / PerfFix" 这类 RQ，DevEco 已经有一版规则实现**，属于必须引用的 prior art，也说明"采集"不是难点，"判定 + 归因"才是。

## 7. 对 HapTest 的三条路

| 路径 | 做法 | 成本 | 保真度 |
| --- | --- | --- | --- |
| **A. trace 离线**（推荐） | `hitrace --trace_begin graphic ability app` → 拉 `.htrace` → 本地 `trace_streamer -e` → SQL | 低：两条 shell + 一个本地二进制 | 中高：有逐帧数据，但要自己写 frame slice 查询 |
| B. hidump-plugin gRPC | 复刻 DevEco 的会话：`fport` + `hiprofiler_cmd -s` + protobuf | 高：protobuf schema + 会话状态机 + daemon 生命周期 | 最高：直接拿 `FpsData` |
| C. `sp_daemon` / `GP_daemon_fps` | 开发板工具 | 低 | 商业鸿蒙手机上大概率不存在 |

**推荐 A**：`hitrace` 是系统自带命令（不像 `sp_daemon` 是开发板产物），`trace_streamer` 已经躺在 DevEco 里且实测能跑。先拿 A 拿到"逐帧 + jank"，等真需要实时 fps 流再上 B。

## 8. 实测：trace_streamer 的库 schema（不需要真机）

喂一个**只有表头的空 trace** 就能让它建库，schema 与数据无关：

```sh
printf '# tracer: nop\n#\n# entries-in-buffer/entries-written: 0/0   #P:8\n#\n#           TASK-PID     CPU#  |||||  TIMESTAMP  FUNCTION\n#              | |         |   |||||     |         |\n' > min.htrace
D=/Applications/DevEco-Studio.app/Contents/tools/profiler/dic_server
DYLD_LIBRARY_PATH="$D/lib" "$D/trace_streamer" min.htrace -e out.db
sqlite3 out.db ".tables"
```

得到 **92 张表**，覆盖：`frame_slice`/`frame_maps`/`dynamic_frame`、`hidump`、`app_startup`、`cpu_usage`/`sched_slice`/`thread_state`、`memory_*`（7 张）、`diskio`/`file_system_sample`、`network*`、`gpu_slice`、`xpower_*`（7 张）、`js_heap_*`（9 张）、`native_hook*`/`ebpf_callstack`、`perf_*`（5 张）、`hisys_*`、`animation`、`syscall`、`bio_latency_sample`、`dma_fence`、`smaps`、`symbols`。

关键四张：

```sql
CREATE TABLE frame_slice(
  id INT, ts INT, vsync INT, ipid INT, itid INT, callstack_id INT,
  dur INT, src TEXT, dst INT, type INT, type_desc TEXT, flag INT,
  depth INT, frame_no INT
);
CREATE TABLE frame_maps(id INT, src_row INT, dst_row INT);
CREATE TABLE hidump(id INT, ts INT, fps INT);                 -- FPS 采样序列
CREATE TABLE app_startup(                                      -- 冷启动分段
  id INT, call_id INT, ipid INT, tid INT,
  start_time INT, end_time INT, start_name INT, packed_name TEXT
);
CREATE TABLE dynamic_frame(id INT, x INT, y INT, width INT, height INT,
                           alpha TEXT, name TEXT, end_time INT);
```

即：**`frame_slice.dur` + `flag` + `type_desc` 就是 jank 判定的全部输入**，`hidump(ts, fps)` 是独立的 FPS 流。二进制里还能看到 `frame_data` / `frame_dynamic_data` / `frame_animation_data` 三个数据源名与 `AnimationFilter`。

未取到：`data_type(typeId, desc)` 与 `data_dict` 是空表，由真实 trace 填充——所以 `flag` 的取值、`type_desc` 的字符串枚举仍需一份真 trace 才能确认（但**表名和列名不再是未知**）。

## 9. 未验证（需要真机）

- `hitrace` 在 JUY-AL50 上是否可用、`graphic` 分类是否真的产出 `frame_slice` 行。
- `flag` / `type_desc` 的具体取值与 jank 语义（表结构已知，枚举未知）。
- `hiprofiler_cmd` / `hiprofiler_plugins` 在商业 HarmonyOS（非 OpenHarmony）上是否存在。
- `hidumper -s RenderService` 是否能给出 fps（DevEco 用的是 `hidump-plugin`，不是这条）。

这四条都只能靠 `haptest harmony probe` 在真机上一次性问清楚——正好是 `develop/harmonyos-device-day.md` 第 3 步要做的事。

