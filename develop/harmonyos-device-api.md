# HarmonyOS 设备 API 与 CLI

HapTest 通过 HDC + uitest agent + Hypium RPC 控制 HarmonyOS 设备。本文是 `HarmonyDevice` 与 `haptest harmony` 的参考；设计取舍见 `docs/superpowers/specs/2026-11-01-harmonyos-device-api-design.md`。

## 前置

1. HDC 在 `PATH`：`hdc version` 有输出。缺失时所有入口都会打印安装指引并退出 3。
2. 设备已连接并授权：`hdc list targets` 显示 `Connected`。
3. 设备已解锁——锁屏时 `observe` 不返回 UI 树与截图，动作类命令直接拒绝。

HDC 来自 DevEco Studio / Command Line Tools：

```sh
export PATH="$HOME/Library/Huawei/Sdk/openharmony/<version>/toolchains:$PATH"
```

## API

```ts
import { HarmonyDevice } from 'haptest';

const device = await HarmonyDevice.connect({ serial });   // 省略 serial 时要求恰好一台在线设备
const observation = await device.observe({ screenshot: true });

device.find({ text: '搜索' });                             // 基于最近一次 observation
await device.tap({ selector: { text: '搜索' } });          // 或 { x, y, observationId }
await device.swipe({ from: { x: 500, y: 1800 }, to: { x: 500, y: 600 }, observationId: observation.observationId });
await device.typeText('hello');                            // 只写入当前唯一焦点；无 verify
await device.pressKey('BACK');
device.findApps('settings');                               // [{ bundleName }]
await device.launchApp('com.huawei.hmos.settings');
await device.stopApp('com.huawei.hmos.settings');
await device.close();
```

不变量（由 `HarmonyDevice` 强制执行，不依赖调用方自觉）：

- 动作前必须有 observation；`mutate()` 之后 observation 立即失效。
- 坐标动作绑定 `observationId` + 前台 bundle + 屏幕尺寸 + `contentSig`，任一变化即 `STALE_OBSERVATION`。
- selector 匹配到多个候选时返回 `AMBIGUOUS_TARGET` + 候选列表，不猜。
- 动作抛错统一为 `ACTION_OUTCOME_UNCERTAIN`（`replayAction: false`），调用方必须先观察再决定。
- 同一 serial 的独占由跨进程文件租约保证；第二个会话得到 `DEVICE_BUSY`。
- 锁屏时不返回树与截图。

## CLI

stdout 永远是 JSON；人类可读摘要只写 stderr。

```sh
haptest harmony doctor   [--serial <s>]
haptest harmony devices
haptest harmony observe  [--serial <s>] [--screenshot <file>]
haptest harmony apps     [--query <q>]
haptest harmony tap      (--id|--text|--text-contains|--hint|--name <v>) [--index <n>] | (--x <n> --y <n>)
haptest harmony type     <text> [--allow-newlines]
haptest harmony key      <BACK|HOME|ENTER|DELETE|SPACE|TAB|ESCAPE|UP|DOWN|LEFT|RIGHT>
haptest harmony swipe    --from <x,y> --to <x,y> [--speed <n>]
haptest harmony launch   <bundle>
haptest harmony stop     <bundle>
haptest harmony serve    [--serial <s>]
```

每个一次性命令内部先 `observe`、再动作、再 `observe`，最后打印动作后的 observation（含 `observationId`、`bundleName`、`contentSig`、`tree`）。

`--expect-bundle <bundle>` / `--expect-sig <sig>` 用于拒绝过期操作：与本次 observe 不一致时退出 3 且不执行动作。

### 退出码

| 码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 1 | 动作/查询失败（`SELECTOR_NOT_FOUND`、`AMBIGUOUS_TARGET`、`ACTION_OUTCOME_UNCERTAIN` 等） |
| 2 | 用法错误（未知命令、未知 flag、多余参数、参数格式错、`--index` 越界） |
| 3 | 前置条件不满足（`HDC_UNAVAILABLE`、`NO_DEVICE`、`MULTIPLE_DEVICES`、`DEVICE_OFFLINE`、`DEVICE_BUSY`、锁屏、`STALE_OBSERVATION`、`INPUT_FOCUS_REQUIRED`、`SENSITIVE_FIELD`） |

失败时 stdout 为 `{ ok:false, errorCode, message, details?, nextStep? }`。`doctor` 发现环境问题时同样输出 `ok:false` + `errorCode:"DEVICE_NOT_READY"` + `issues`，退出 3。

## serve：有状态 JSON-lines 会话

一次连接、连续调用，保留 observationId 语义。每行一个请求，每行一个响应：

```json
{"id":1,"method":"observe","params":{}}
{"id":1,"ok":true,"result":{"observationId":"o1","locked":false,"bundleName":"com.example.app","contentSig":"sig-1","tree":{}}}
{"id":2,"method":"tap","params":{"selector":{"text":"OK"}}}
{"id":2,"ok":true,"result":{"outcome":"completed"}}
{"id":3,"method":"close","params":{}}
{"id":3,"ok":true,"result":{"closed":true}}
```

方法：`observe`、`find`、`tap`、`swipe`、`type_text`、`press_key`、`apps`、`launch_app`、`stop_app`、`close`。`observe` 带 `{"screenshot":true}` 时，`result.screenshot.data` 是 base64 像素。非法 JSON → `BAD_REQUEST`；未知方法 → `UNKNOWN_METHOD`；关闭后再发请求 → `SESSION_CLOSED`；这三种情况都不会结束进程。

## E2E

```sh
HAPTEST_E2E_SERIAL=<serial> npm run e2e          # 可选 HAPTEST_E2E_BUNDLE，默认 com.huawei.hmos.settings
```

- 无 `HAPTEST_E2E_SERIAL`：打印 `SKIPPED`，退出 0。
- 有设备：`observe → apps → launch_app → observe → tap(SearchField) → press_key(BACK) → observe`，每步打印 `PASS <name> <ms>`，末尾汇总耗时。
- 任一步失败：退出 1，`E2E FAILED: <message>`。

E2E 直接 `require('../../lib')`，验证的是 `npm run build` 之后真正发布的产物。

## 已知限制

- **应用名只有 bundle id**：设备上取本地化名需要逐 App 查询，本轮不实现；`apps` 只返回 `bundleName`。
- **锁屏判定是启发式**：只认 `ScreenLockRootComponent` / `MainPageView_Screen_Lock_Home`；识别不到时按未锁屏处理（换机型需复核）。
- **认证字段靠正则**：`id/name/hint` 命中敏感词即拒绝代输；未标注的密码框会漏判。
- **输入框内容读不到**：`Component.text` 的 `@Transform` 会清空 `TextInput/TextArea/SearchField` 的文本，`observe` 返回的树里这些字段的 `text` 恒为空，因此没有输入回读。
- **`observe({screenshot:true})` 最多三次 UI dump**（截图前后各一次锁屏复核），慢设备上耗时明显。
- **底座仍用 `shell: true`**：`Hdc` 的既有方法拼接命令字符串；Node 会打印 `DEP0190` 警告。新增方法（`getVersion`、`inputFocusedText`）已用 `shell:false`。
- **`ts-node` 不可用**：本机 TypeScript 7.0.2 与 ts-node 10.9.2 不兼容，`npm run haptest` / `npm run dump` 这两个旧脚本会失败；`npm run build`、`npm test`、`npm run e2e` 不受影响。
