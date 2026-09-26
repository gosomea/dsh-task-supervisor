# 可用性回归样本

`separate-turns` 固定了开发试跑里出现的误判完成：最终文件正确，但只读核对和写入发生在同一轮。评分器从测试工作区外读取原生 DSH Session 日志，依据已批准任务后的 `turn/start`、`turn/end`、`tool/call` 与 `tool/result` 独立判定。被中断的轮次不满足“完成只读轮次”；只有工具调用而没有成功工具结果也不算完成操作。

准备：`python3 eval/reliability-v1/check.py prepare separate-turns /tmp/case-dir`。验收：`python3 eval/reliability-v1/check.py check separate-turns /tmp/case-dir /absolute/path/to/session.v4.jsonl.zstd`。评分器仅适用于本题，不会进入 Agent 工作区，也不是插件运行时的硬编码规则。[真实模型结果](results-20260927.zh.md)记录了原始误判、提示修改后的再次误判，以及增加执行层门禁后的中断恢复通过。
