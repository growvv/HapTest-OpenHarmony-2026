# HapTest

## 面向 OpenHarmony 应用的多模态智能测试与性能分析框架

**北京航空航天大学 · SMAT · 刘发荣（独立作者）**

HapTest 将页面迁移图探索、系统测试服务接入、截图与控件候选联合规划，以及逐帧性能证据组合为可扩展测试框架。参赛工作聚焦开源鸿蒙框架与工具链创新。

**[完整参赛材料](submission/README.md)**　[作品简介](submission/01-参赛作品简介.md)　[设计文档 DOCX](submission/SMAT团队-赛道一-开发设计文档.docx)　[设计文档 PDF](submission/SMAT团队-赛道一-开发设计文档.pdf)　[答辩 PPT](submission/SMAT团队-赛道一-答辩.pptx)　[PPT PDF](submission/SMAT团队-赛道一-答辩.pdf)　[项目视频](submission/03-项目展示视频.mp4)

## 功能

- Page/Component/PTG 页面建模，支持 DFS、BFS、随机、回放与静态引导策略扩展。
- HDC、uitest、Hypium RPC 设备接入，HarmonyDevice 观察与动作 API、JSON-lines 会话、Web UI Viewer。
- 新增 `harmony plan`：图像输入模型联合截图、候选控件、任务与历史规划，默认预览，逐步执行后重新观察。
- 新增 `harmony trace` / `swipe --measure` 与 `perf analyze`：系统 trace 采集、SQLite frame_slice 筛选与 JSON/CSV/HTML 报告。

2026年11月7日本地构建和 **68 项测试通过**。真机 E2E 当前跳过，新模块已完成本地协议和离线验证；真实设备、模型效果与系统帧标记需要按实验方案验收。

## 快速开始

```powershell
$env:NODE_ENV='development'
npm install --include=dev
npm run build
npm test -- --run
node bin/haptest harmony doctor
```

设备测试需要 DevEco Command Line Tools 的 `hdc`、已授权且解锁的兼容设备。安装依赖时可使用 Node.js 20 或更新版本。

```powershell
# 页面探索，包名替换为测试应用
node bin/haptest -i com.example.demo --policy greedy_dfs -o out
# 控件树与截图查看
node bin/haptest ui-viewer
# 不依赖真机的逐帧样本
node bin/haptest perf analyze --db submission/05-辅助材料/样本/frames-fixture.db --output out/sample --ipid 10 --type app --refresh-rate 60 --jank-flags 7
```

多模态模型配置、执行及真机 trace 命令见[新增功能使用说明](doc/multimodal-and-frames.md)。设备 API 与会话协议见 [HarmonyDevice 文档](develop/harmonyos-device-api.md)。原有安装、静态分析配置及详细用法见[原项目 README](doc/README-original.md)。

## 代码与归属

源码位于 `src/`，单元测试位于 `test/unit/`，真机验证位于 `test/e2e/`，参赛材料位于 `submission/`。构建产物 `lib/` 和实验输出 `out/` 不进入源码提交。

基于 [SMAT-Lab/HapTest](https://github.com/SMAT-Lab/HapTest) 既有开源实现继续集成。保留 [Apache License 2.0](LICENSE) 与原始代码版权声明。本次参赛由刘发荣独立负责，署名不改变既有开源代码、依赖及相关研究的归属。

## 项目展示视频

[观看或下载视频（MP4，约 9 分 25 秒）](submission/03-项目展示视频.mp4)。视频含中文合成讲解与字幕，展示系统结构、多模态规划、逐帧分析及离线人工样本报告。
