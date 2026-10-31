# AGENTS.md

HapTest：OpenHarmony UI 自动化测试框架。TypeScript（CommonJS），`src/` 编译到 `lib/`。

## 命令

```sh
npm run build                 # tsc → lib/
npm test -- --run             # vitest，只跑 test/unit
HAPTEST_E2E_SERIAL=<serial> npm run e2e   # 真机链路；无 serial 时 SKIPPED 退出 0
```

HarmonyOS 设备 API 与 CLI 的用法见 `develop/harmonyos-device-api.md`。

## 测试标准

**只写会失败的测试。** 删掉下面这些，写了也要在 review 里被打回：

- 断言 mock 被调用几次、按什么顺序 —— 除非这个顺序本身就是产品不变量（例如"任何动作之前必须先 observe"）。
- 断言导出存在性、`typeof fn === 'function'` —— 这是 `tsc` 和类型系统的职责。
- 让假对象回放你刚写死的返回值，再断言它等于那个值（`findApps: () => [{ bundleName: 'com.settings' }]` 然后 `expect(...).toEqual([{ bundleName: 'com.settings' }])`）。
- 同一行为按命令复制 N 份 —— 用表驱动合成一条。
- 断言"调用没有抛错"就算通过。

**该写的是：**

- 真实输出：stdout 的 JSON、退出码、stderr 里给人看的话。
- 真实 IO：落盘的文件、起的子进程、文件锁、真实 socket。
- 状态机韧性：畸形输入之后进程是否还活着、还能不能继续响应。
- 安全不变量：锁屏、认证字段、过期 observation、不重放。

判定口诀：**"这条测试删掉之后，哪种回归会溜过去？"** 答不出来就删。

## 环境陷阱

- `NODE_ENV=production` 下 `npm install` 会剪掉 devDependencies，`tsc` 消失。用 `NODE_ENV=development npm install --include=dev`。
- 本机 `typescript` 7.0.2 是 ts-node 的 peer 自动装的，与 ts-node 10.9.2 不兼容 → `npm run haptest` / `npm run dump` 会失败。E2E 因此直接 `require('lib/')` 跑 node，不走 ts-node。
- `hdc` 不在 `PATH` 时，所有入口必须打印"装 DevEco CLI Tools + 加 PATH"的指引并退出 3，不能抛裸 `Error`。

## 提交前

`npm run build` 与 `npm test -- --run` 全绿；不要提交 `lib/`、`out/`。
