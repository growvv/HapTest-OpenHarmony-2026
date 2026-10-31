# 设备到手后的执行顺序

本文件是"等真机"期间唯一要做的事：按顺序跑，把输出贴回本文。不要跳过 1–2 直接做 3。

## 1. 环境

```sh
export PATH="$HOME/Library/Huawei/Sdk/openharmony/<version>/toolchains:$PATH"
hdc version
hdc list targets        # 期望：Connected
```

## 2. 先验遥控链路，不验性能

```sh
HAPTEST_E2E_SERIAL=<serial> npm run e2e
```

- 全绿 → 记录耗时表，进入第 3 步。
- 失败 → **停在这里修**。jank 测量建立在 observe/swipe 可用之上；链路不绿，测量出来的数没有意义。
- 已知要盯的点：`observe` 里 `pages[0]` 可能取到输入法页（评审 M5）、`SearchField` 歧义会直接失败（M9）。

## 3. 探测帧数据来源

```sh
node bin/haptest harmony probe
```

DevEco 逆向结论（`develop/deveco-perf-sources.md`）给出的候选，按优先级：

1. `hitrace` + 本地 `trace_streamer`（首选）
   - `hitrace --trace_begin graphic ability app` / `--trace_finish -o`
   - `ls /Applications/DevEco-Studio.app/Contents/tools/profiler/dic_server/trace_streamer`
2. `hiprofiler_cmd -s` / `pidof hiprofiler_plugins`（gRPC 路径的前置，只探测不实现）
3. `sp_daemon`（开发板工具，商业机大概率没有）

把每条命令的原始输出贴到下面（截断 4KB 也算）。**这一步的产物就是解析器的规格**。

```
### 设备
serial / 型号 / OpenHarmony 版本 / 刷新率：
### hitrace
raw:
### trace_streamer
路径存在？版本（-v）：
### hiprofiler
raw:
### sp_daemon
raw:
```

## 4. 采一次真 trace

```sh
node bin/haptest harmony swipe --from <x1,y1> --to <x2,y2> --measure
```

跑完把 `.htrace` 留下的路径、`sqlite3 out.db ".tables"`、以及帧表的 `.schema` 贴回本文。schema 已经实测过（见 `develop/deveco-perf-sources.md` §8），真机只需要补**枚举值**：

```sh
sqlite3 out.db "SELECT DISTINCT flag, type_desc FROM frame_slice;"
sqlite3 out.db "SELECT frame_no, ts, dur, flag, type_desc FROM frame_slice ORDER BY ts LIMIT 20;"
```

## 5. 数值可信性

解析器写完后，用同一个手势在同一屏上跑 3 次：

```sh
node bin/haptest harmony swipe --from <x1,y1> --to <x2,y2> --measure
```

三次的 `avgFps` 差异应在 ±3 以内；否则是采样窗口没盖住动作，不是设备抖动。
