# Goal / Plan / Task Supervisor 开发试跑 v1

这是评测流程的试跑集，用来发现任务定义、宿主控制和评分脚本的问题。每题每组仅跑一次，不用于宣称哪个工作流更优。正式比较需另建保留集、多次配对运行，并增加长任务、需求变更和失败恢复场景。

[2026-09-26 试跑结果与生命周期发现](results-20260926.zh.md)记录了六次产品轨道运行、外部验收和一次审查误判。

## 固定规则

- [dataset.json](dataset.json) 是各组共同的初始任务和停止规则。每组从同一 `fixtures/<case>` 复制到独立目录，选择日常 Web profile 中 `deepseek-codebuddy` 的首个模型。
- 产品轨道使用原生交互：Goal 为 `/goal <prompt>`，Plan 为 `/plan <prompt>`，Supervisor 为 `/task new <prompt>`。Plan 或 Supervisor 提交初始计划时，只在界面批准一次；额外的人类纠偏和决策单独记录。Plan 空闲后不额外发送续行指令。
- 各组都可自主规划。Task Supervisor 的阶段计划不作为外部评分依据。不要把 `pilot.py` 或私有检查内容放入被测工作区。
- 外部评分在工作区外运行。先看持久化 Session 与实际产物，再用 `pilot.py check` 评分；插件审查意见不是独立验收结果。
- 停止条件：有效的完成声明、需要用户决策、主模型轮次达到 12、或运行 15 分钟。因基础设施错误中止时，保留该次尝试和错误，不静默补跑。

## 命令

```bash
python3 eval/pilot-v1/pilot.py prepare ledger-rollup /tmp/ledger-goal-1
python3 eval/pilot-v1/pilot.py prompt ledger-rollup
python3 eval/pilot-v1/pilot.py check ledger-rollup /tmp/ledger-goal-1
```

`prepare` 拒绝覆盖已有目录。运行前记录 dataset、fixture、检查器、DSH、插件的版本或哈希；运行后记录模型实际路由、主轮次、审查次数、人工介入、停止原因、外部评分、产物差异及 Session 路径。
