# DevEco Studio 性能采集接口参考（HapTest 后续开发用）

> 日期：2026-11-01 · 目标版本：DevEco Studio 26.0.0.865（HarmonyOS 6/7）
> 方法：jar 静态提取（`javap` + 常量池）+ 本地二进制实测（`trace_streamer`）+ REA（`inspect-macho` / `inspect-artifact`）
> 配套：`deveco-perf-protocol-messages.md`（155 个 protobuf 消息的完整字段表）、`deveco-perf-sources.md`（逆向过程与证据）

本文是**接口与参数手册**：设备侧怎么起、gRPC 怎么谈、每个指标从哪来、离线 schema 长什么样、HapTest 该怎么接。

---

## 0. 一句话架构

```
HapTest / DevEco (host)                          设备
  hdc fport <local> <device:port>  ──────────────►
  hiprofiler_cmd -s                ──────────────► hiprofilerd
                                                    └ hiprofiler_plugins
  gRPC ProfilerService: Create/Start/Fetch/Stop/Destroy/KeepSession
                     ◄────────────────────────────  ProfilerPluginData (protobuf)
  hitrace --trace_begin/--trace_finish  ─────────► .htrace
  trace_streamer .htrace -e out.db  (本地)         → 92 张表 SQLite
```

三条通路，按成本从低到高：

| 通路 | 实时性 | 拿到什么 | 依赖 |
| --- | --- | --- | --- |
| **A. hitrace + 本地 trace_streamer** | 离线（动作后几秒） | 逐帧 `frame_slice`、调度、CPU、内存、IO、网络、xpower | `hitrace`（系统命令）+ DevEco 自带的 `trace_streamer` |
| **B. hiprofiler gRPC** | 实时（毫秒~秒级采样） | FPS 采样流、CPU 负载、内存明细、GPU、功耗 | `hiprofiler_cmd` + `hiprofiler_plugins` + 端口转发 |
| **C. hidumper** | 一次性 | 窗口/Ability 快照 | `hidumper` |

**建议**：先做 A（便宜、可离线、无需协议实现），需要实时 FPS 流时再上 B。

---

## 1. 设备侧生命周期（命令常量，来自 `CmdConstants` / `OpenHarmonyDevice`）

```sh
# 端口转发（gRPC 走这里）
hdc fport <localPort> <devicePort>
hdc fport rm <localPort> <devicePort>

# daemon 生命周期
hdc shell hiprofiler_cmd -s        # 启动（失败重试，DevEco 有 CHECK_HIPROFILER_INTERVAL / TIME_OUT）
hdc shell hiprofiler_cmd -k        # 停止

# 就绪探测
hdc shell pidof hiprofiler_plugins
hdc shell pidof hiprofilerd

# trace 落盘
/data/local/tmp/trace_%s.htrace

# 简单 trace（不走 daemon）
hdc shell hitrace --trace_begin ability app
hdc shell hitrace --trace_finish -o /data/local/tmp/x.htrace

# 一次性 dump
hdc shell hidumper -s WindowManagerService -a -a
hdc shell hidumper -s AbilityManagerService -a -a
hdc shell hidumper -s 1910 -a 'Thaw <pid>'
```

设备进程：`hiprofilerd`、`hiprofiler_plugins`、`native_daemon`。

---

## 2. gRPC 协议

### 2.1 两个服务

**ProfilerService**（host → daemon，8 个方法，全部 unary）：

| 方法 | 请求 → 响应 |
| --- | --- |
| `getCapabilities` | `GetCapabilitiesRequest` → `GetCapabilitiesResponse{status, capabilities[]}` |
| `createSession` | `CreateSessionRequest{requestId, sessionConfig, pluginConfigs[]}` → `{status, sessionId, pluginStatus[]}` |
| `startSession` | `StartSessionRequest{requestId, sessionId, updateConfigs[]}` → `{status, pluginStatus[]}` |
| `fetchData` | `FetchDataRequest{requestId, sessionId, addtionData}` → `{status, responseId, hasMore, pluginData[]}` |
| `keepSession` | `KeepSessionRequest{requestId, sessionId, keepAliveTime}` → `{status}` |
| `stopSession` | `StopSessionRequest{requestId, sessionId}` → `{status, pluginStatus[]}` |
| `destroySession` | `DestroySessionRequest{requestId, sessionId}` → `{status, pluginStatus[]}` |
| `subscribeProfilerEvt` | `SubscribeProfilerEvtRequest{requestId, sessionId, addtionData}` → `{status, responseId, hasMore, pluginState[]}` |

**PluginService**（plugin → host，反向，4 个方法）：`registerPlugin`、`unregisterPlugin`、`getCommand`、`notifyResult`。

### 2.2 会话配置

```
ProfilerSessionConfig {
  buffers[]            : { pages:int, policy:int }
  sessionMode          : int        // GrpcConstants.SessionMode: ONLINE / OFFLINE
  resultMaxSize        : int
  sampleDuration       : int
  keepAliveTime        : int
  discardCacheData     : bool
  splitFile            : bool
  singleFileMaxSizeMb  : int
}
```

`GrpcConstants` 里的会话参数：`MIN_PORT`、`MAX_PORT`、`DEVICE_PORT`、`BUFFER_PAGES`、`KEEP_SESSION_TIME`、`KEEP_SESSION_REQUEST_INTERVAL`、`FETCH_DATA_INTERVAL`、`SYNC_TIME_INTERVAL`、`TRACE_FILE_PATH=/data/local/tmp/trace_%s.htrace`。

### 2.3 插件配置（7 个，`configData` 是序列化后的子消息）

| 插件名 | 配置消息 | 参数 |
| --- | --- | --- |
| `hidump-plugin` | `HidumpConfig` | `reportFps:bool`、`sections:int` |
| `cpu-plugin` | `CpuConfig` | `pid:int`、`reportProcessInfo:bool` |
| `memory-plugin` | `MemoryConfig` | `reportProcessTree`、`reportSysmemMemInfo`、`sysMeminfoCounters[]`、`reportSysmemVmemInfo`、`sysVmeminfoCounters[]`、`reportProcessMemInfo`、`reportAppMemInfo`、`reportAppMemByMemoryService`、`pid[]`、`reportSmapsMemInfo`、`reportPurgeableAshmemInfo`、`reportDmaMemInfo`、`reportGpuMemInfo`、`reportGpuDumpInfo` |
| `gpu-plugin` | `GpuConfig` | `pid:int`、`reportGpuInfo:bool`、`reportGpuDataArray:bool` |
| `xpower-plugin` | `XpowerConfig` | `messageType[]`（功耗报告类型位图） |
| `network-plugin` | `NetworkConfig` | `pid[]`、`singlePid:int` |
| `ftrace-plugin` | `TracePluginConfig` | `ftraceEvents[]`、`hitraceCategories[]`、`hitraceApps[]`、`bufferSizeKb`、`flushIntervalMs`、`flushThresholdKb`、`parseKsyms`、`tracePeriodMs`、`traceDurationMs`、`debugOn`、`discardCacheData`、`hitraceTime` |
| `diskio-plugin` | `DiskioConfig` | `reportIoStats:int` |

每个插件配置都包在 `ProfilerPluginConfig{sampleInterval, configData:bytes, isProtobufSerialize:bool}` 里。

### 2.4 数据回传

```
ProfilerPluginData {
  status:int, data:bytes, clockId:int,
  tvSec:long, tvNsec:long, sampleInterval:int
}
```

`data` 按插件反序列化成对应 `*PluginResult`。实时采样的本质就是**循环 `fetchData`**（DevEco 用 `FETCH_DATA_INTERVAL` + `keepSession` 保活）。

---

## 3. 实时指标矩阵

| 指标 | 插件 | 开关 | 结果消息（关键字段） |
| --- | --- | --- | --- |
| **FPS 采样** | `hidump-plugin` | `reportFps=true` | `FpsData{id, time{tvSec,tvNsec}, fps}` → `HidumpInfo{fpsEvent[]}` |
| **CPU 负载** | `cpu-plugin` | `reportProcessInfo` | `CpuData{processNum, userLoad, sysLoad, totalLoad, cpuUsageInfo{processCpuTimeMs, cores[]}, threadInfo[]}` |
| **单核频率** | `cpu-plugin` | 同上 | `CpuCoreUsageInfo{cpuCore, curFrequencyKhz, minFrequencyKhz, maxFrequencyKhz, isLittleCore}` |
| **线程状态** | `cpu-plugin` | 同上 | `ThreadInfo{tid, threadState, threadCpuTimeMs, timestamp}` |
| **内存（进程/系统/smaps/dma/gpu）** | `memory-plugin` | 见 2.3 的 14 个 flag | `MemoryData{processesinfo[], meminfo[], vmeminfo[], zram, ashmeminfo[], dmainfo[], gpumemoryinfo, gpudumpinfo, rsdumpinfo[], windowinfo[]}` |
| **GPU 占用** | `gpu-plugin` | `reportGpuInfo` | `GpuData{boottime, gpuUtilisation, gpuDataArray[]}` |
| **功耗 / 刷新率分布** | `xpower-plugin` | `messageType[]` | `AppDetailDisplay{count1Hz…count180Hz}`、`RenderServiceSkip{skipNum}`、`GpuRedraw{frameNum}`、`AppStatistic{component→energy,time}` |
| **网络字节/包** | `network-plugin` | `pid[]` | `NetworkData{pid, tvSec, tvNsec, txBytes, rxBytes, details}`、`NetworkFlowData{rxPackets, txPackets, …}` |
| **磁盘 IO** | `diskio-plugin` | `reportIoStats` | `DiskioData{rdSectorsKb, wrSectorsKb, statsData{cpuinfo[], statsinfo[], estatsinfo[]}}` |

注意 `xpower` 的 `AppDetailDisplay` 是**按刷新率分桶的帧计数**（1/5/10/15/24/30/45/60/90/120/180Hz），配 `RenderServiceSkip.skipNum` 与 `GpuRedraw.frameNum`，这是除 `frame_slice` 之外另一条掉帧证据。

---

## 4. 离线：`trace_streamer` + 92 张表

### 4.1 用法

```sh
D=/Applications/DevEco-Studio.app/Contents/tools/profiler/dic_server
DYLD_LIBRARY_PATH="$D/lib" "$D/trace_streamer" trace.htrace -e out.db   # → SQLite
DYLD_LIBRARY_PATH="$D/lib" "$D/trace_streamer" trace.htrace -c          # 命令行模式
DYLD_LIBRARY_PATH="$D/lib" "$D/trace_streamer" trace.htrace -m <metrics>
DYLD_LIBRARY_PATH="$D/lib" "$D/trace_streamer" --list                   # 支持的 ability
```

支持的 ability：`hiperf, ebpf, native_hook, hilog, hisysevent, arkts, bytrace, rawtrace, htrace, ffrt, memory, hidump, cpudata, network, diskio, process`（+`xpower`）。

**关键技巧**：喂一个只有表头的空 trace 就会建库，schema 与数据无关（见 `deveco-perf-sources.md` §8），所以解析器可以先按 schema 写好，等真数据。

### 4.2 表分组（92 张）

| 域 | 表 |
| --- | --- |
| **帧/渲染** | `frame_slice`、`frame_maps`、`dynamic_frame`、`gpu_slice`、`animation` |
| **FPS** | `hidump(ts, fps)` |
| **启动** | `app_startup(call_id, ipid, tid, start_time, end_time, start_name, packed_name)` |
| **进程/线程/调度** | `process`、`thread`、`thread_state`、`sched_slice`、`live_process`、`task_pool`、`static_initalize` |
| **CPU** | `cpu_usage`、`cpu_measure_filter` |
| **内存** | `memory_ashmem`、`memory_cpu`、`memory_dma`、`memory_process_gpu`、`memory_profile`、`memory_rs_image`、`memory_window_gpu`、`smaps`、`paged_memory_sample` |
| **IO** | `diskio`、`filesystem_io`、`file_system_sample`、`bio_latency_sample` |
| **网络** | `network`、`network_information`、`network_time_information` |
| **功耗** | `xpower_app_detail_cpu/display/gpu/wifi`、`xpower_app_statistic`、`xpower_component_top`、`xpower_measure` |
| **JS/ArkTS** | `js_config`、`js_cpu_profiler_node/sample`、`js_heap_*`（9 张） |
| **native/hiperf** | `native_hook`、`native_hook_frame`、`native_hook_statistic`、`perf_*`（5 张）、`ebpf_callstack`、`callstack`、`symbols` |
| **系统事件** | `hisys_all_event`、`hisys_event_measure`、`log`、`syscall`、`irq`、`dma_fence`、`timerfd_wakeup`、`device_info`、`device_state`、`trace_config`、`trace_range`、`meta` |

### 4.3 核心查询

```sql
-- 逐帧（jank 判定的全部输入）
SELECT frame_no, vsync, ts, dur, flag, type_desc, ipid
FROM frame_slice WHERE ipid = ? AND ts BETWEEN ? AND ?
ORDER BY ts;

-- FPS 采样序列
SELECT ts, fps FROM hidump ORDER BY ts;

-- 冷启动分段
SELECT start_name, start_time, end_time, (end_time - start_time) AS dur
FROM app_startup WHERE ipid = ?;

-- 进程/线程
SELECT ipid, pid, name FROM process;
SELECT itid, tid, name, is_main_thread FROM thread WHERE ipid = ?;

-- 内存：进程级 pss 汇总（live_process 自带 pss_info）
SELECT process_id, process_name, cpu_usage, pss_info, thread_num
FROM live_process ORDER BY pss_info DESC LIMIT 20;
```

`device_info` 里有 `physical_frame_rate` —— **判断 60/120Hz 基线的官方字段**。

---

## 5. HapTest 集成方案

| 方案 | 做法 | 成本 | 适合 |
| --- | --- | --- | --- |
| **A（推荐）离线采集** | `hitrace --trace_begin graphic ability app` → 动作 → `--trace_finish -o` → `hdc file recv` → 本地 `trace_streamer -e` → SQL | 低 | 自动化性能分析、批量回归、agent 每步后取数 |
| **B 实时 gRPC** | 复刻 `fport + hiprofiler_cmd -s + ProfilerService` 会话，循环 `fetchData` | 高（要 protobuf 编解码 + 会话状态机） | 实时 FPS/CPU 曲线、长时监控 |
| **C 混合** | 默认 A；需要实时曲线时对 `hidump-plugin` 开 B | 中 | 交互式 Profiler 类体验 |

落地顺序建议：

1. `haptest harmony probe` 探测 `hitrace` / `trace_streamer` / `hiprofiler_cmd` 可用性（`harmonyos-device-day.md` 第 3 步）。
2. 实现 A：`trace(action)` + `frames` + `appStartup` + `cpu/memory` 查询。
3. 需要实时时再实现 B，protobuf 定义照 `deveco-perf-protocol-messages.md` 生成。

---

## 6. 未验证（需要真机）

- `hitrace` / `hiprofiler_cmd` / `hiprofiler_plugins` 在 JUY-AL50（商业 HarmonyOS 7）上是否存在。
- `graphic` 分类是否真的产出 `frame_slice` 行；`flag` / `type_desc` 的取值枚举。
- `hidump-plugin` 的 FPS 采样间隔与精度（`sampleInterval` 的实际生效值）。
- gRPC 端口（`DEVICE_PORT`）的实际数值与是否需要鉴权。

这些都进 `develop/harmonyos-device-day.md` 的探测清单，一次真机跑完即可全部消解。
