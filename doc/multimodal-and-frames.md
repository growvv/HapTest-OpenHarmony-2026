# 多模态规划与逐帧耗时分析

## 环境与构建

使用 Node.js 20 或更新版本。安装 DevEco Command Line Tools 并把 hdc 所在 toolchains 目录加入 PATH。设备先完成授权与解锁。

```powershell
$env:NODE_ENV='development'
npm install --include=dev
npm run build
npm test -- --run
node bin/haptest harmony doctor
```

## 多模态规划

新入口独立于原有 `--llm` 文本策略。使用支持图像输入、Chat Completions 和 JSON object 输出的服务。环境变量配置密钥，不写入仓库。截图及候选 UI 文本会发送到配置的模型服务，请使用测试应用及测试数据。

```powershell
$env:OPENAI_API_KEY='<在本机设置密钥>'
$env:HAPTEST_VISION_MODEL='<支持图像输入与 JSON 输出的模型名称>'
# 兼容服务可额外设置 $env:OPENAI_BASE_URL='https://.../v1'
node bin/haptest harmony plan --task '打开应用设置页面' --output out/plan
# 先检查预览的 plan.json，再启用执行
node bin/haptest harmony plan --task '打开应用设置页面' --execute --max-steps 8 --output out/plan-run
```

默认预览一个动作。执行模式最多 1～50 步，每步重新观察。候选包含从树中得到的点击、屏幕内滑动与返回，不生成自由坐标或输入文本。模型 `done` 仅表示模型判断，应另做业务断言。超时/非法 JSON/过期观察/动作不确定立即停止，不自动重放。输出 `plan.json` 的状态包括 `preview`、`model_completed`、`step_limit`、`stopped_on_error`。

## 采集 trace

```powershell
# 采集 5 秒，期间可在测试设备上触发操作
node bin/haptest harmony trace --seconds 5 --output out/perf
# 或测量一次滑动。坐标按设备实际物理尺寸调整
node bin/haptest harmony swipe --from 500,1600 --to 500,500 --measure --output out/perf
```

设备需支持 `hitrace --trace_begin graphic ability app`。命令结束时拉取 `.htrace` 并写入 `capture.json`。动作失败也会结束 trace，且不重放。采集可能与其他 profiler 会话冲突，测量时保持设备采集独占。

本地准备与系统版本兼容的 `trace_streamer`，可使用环境变量 `HAPTEST_TRACE_STREAMER` 或命令参数 `--trace-streamer <可执行文件路径>` 自动转换。某些发行版本需要把其随附动态库路径加入操作系统的库搜索路径。仓库不打包 DevEco 二进制。

```powershell
& '<trace_streamer路径>' '<trace.htrace路径>' -e out/trace.db
node bin/haptest perf analyze --db out/trace.db --output out/frames --refresh-rate 60
# 第一次查看 observedTypes/observedFlags，确认进程和帧类型后细分
node bin/haptest perf analyze --db out/trace.db --output out/frames-app --ipid 12 --type '<实际type_desc>' --refresh-rate 120
# 系统 flag 语义经对应版本确认后，才提供显式映射
node bin/haptest perf analyze --db out/trace.db --output out/frames-app --ipid 12 --jank-flags 1,2
```

`--ipid` 是 trace 内部进程标识，不保证等于系统 PID。时间参数 `--start-ns`、`--end-ns` 采用 trace 时间域的纳秒，区间为左闭右开。

报告输出 `frames.json`、`frames.csv`、`frames.html`。耗时为 `dur/1e6` ms，预算为 `1000/refreshRate` ms，严格大于预算才标记 overBudget。P50/P95 为 nearest-rank。未配置 jank flag 时 `systemJankCount=null`，避免猜测系统枚举。空帧返回 3，缺失 schema 返回 2。不同帧类型、应用与 RenderService 不能直接相加当作显示帧数量；可变刷新率需要分段设置预算。

## 离线可复核样本

```powershell
node bin/haptest perf analyze --db submission/05-辅助材料/样本/frames-fixture.db --output out/sample --ipid 10 --type app --refresh-rate 60 --jank-flags 7
```

样本是人工构造的 6 个有效应用帧：10、16、25、8、34、12 ms，P95=34 ms，超预算 2 帧。另有一个无效负耗时和一个其他进程帧。flag=7 是样本约定，不是系统版本的真实枚举。
