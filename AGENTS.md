# dsh-task-supervisor 工作约定

本项目是独立的 DSH 插件项目，目标是以一个任务督导流程替代 DSH 原生 Goal 与 Plan 的用户工作流。实现前先读 [README.zh.md](README.zh.md)、[架构](docs/architecture.zh.md)、[审查策略](docs/review-policy.zh.md)和[评测设计](docs/evaluation.zh.md)，并遵循本地 DSH 源码仓库的 [AGENTS.md](../../deepseek-harness/AGENTS.md) 与 [架构说明](../../deepseek-harness/docs/architecture.md)。

## 不变量

- DSH 主会话日志是用户指令、Agent 行为和工具结果的共同事实来源；不得创建两份需要人工同步的任务要求。
- 插件拥有持久任务状态、执行计划、续行和完成裁决。主 Agent 执行任务并提出计划变更；独立审查者读取主会话证据，不能代替主 Agent 修改工作区。
- 任何送入模型的插件消息都必须能从持久 session 事件重建。注册、监听和清理遵循 Cordis effect 生命周期。
- 首次自主多轮执行前由用户确认任务要求与初始计划。用户在同一会话中的后续指令不需要额外的“同步确认”。宿主重启后恢复状态，但等待用户手动继续。
- 在隔离 DSH 实例验收；不修改日常 DSH profile，也不改旧原型 `../dsh-jev-verifier/`。
- 先以真实长任务数据和独立验收建立基线，再声称优于 DSH Goal 或 Plan。

## DSH 本地 Skills

DSH 源码仓库的 13 个 skill 已从仓库根目录的 `.agents/skills/` 通过共享 `skills/` 软链接访问。涉及文档、测试、审查与发布时，按任务范围读取对应 skill；不要把 DSH 的 skill 内容复制进本项目。

## 当前状态

这里目前只有设计与开发约定，尚无可安装插件。README 中的目标行为不是已实现能力。
