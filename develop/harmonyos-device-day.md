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

## 3. 探测帧率来源

```sh
node bin/haptest harmony probe
```

把 `raw` 原样贴到下面（截断到 4KB 也算）。**这一步的产物就是解析器的规格**。

```
### 设备
serial / 型号 / OpenHarmony 版本 / 刷新率：
### sp_daemon
raw:
### GP_daemon_fps
raw:
### hidumper -s RenderService
raw:
### hilog（若前三者都不可用）
raw:
```

## 4. 决定实现哪几个解析器

按 `2026-11-01-harmonyos-jank-measurement-design.md` 第 4 节的降级链，只实现 `probe` 认出来的那个来源。一个来源一个文件，没认出来的不注册。

## 5. 数值可信性

解析器写完后，用同一个手势在同一屏上跑 3 次：

```sh
node bin/haptest harmony swipe --from <x1,y1> --to <x2,y2> --measure
```

三次的 `avgFps` 差异应在 ±3 以内；否则是采样窗口没盖住动作，不是设备抖动。
