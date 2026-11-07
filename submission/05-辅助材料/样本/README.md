# 人工构造的逐帧验证样本

该 SQLite 数据库用于验证解析和计算，非真实设备测量。应用 ipid=10，type_desc=app，6 个有效耗时为 10、16、25、8、34、12 ms，另有 1 个负耗时记录和 1 个其他进程的 render 记录。flag=7 是样本约定。

在 60Hz、ipid=10、type=app、jank-flags=7 条件下：frameCount=6，invalidFrameCount=1，overBudgetCount=2，P50=12 ms，P95=34 ms，systemJankCount=2。报告文件由项目 CLI 实际生成。
