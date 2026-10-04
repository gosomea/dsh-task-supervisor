# dsh-task-supervisor 工作约定

本项目是独立的 DSH 插件项目，目标是以一个任务督导流程替代 DSH 原生 Goal 与 Plan 的用户工作流。实现前先读 [README.zh.md](README.zh.md)、[架构](docs/architecture.zh.md)、[任务状态与控制](docs/task-lifecycle.zh.md)、[审查策略](docs/review-policy.zh.md)、[评测设计](docs/evaluation.zh.md)和[首个原型](docs/prototype.zh.md)，并遵循本地 DSH 源码仓库的 [AGENTS.md](../../deepseek-harness/AGENTS.md) 与 [架构说明](../../deepseek-harness/docs/architecture.md)。

## 不变量

- DSH 主会话日志是用户指令、Agent 行为和工具结果的共同事实来源；不得创建两份需要人工同步的任务要求。
- 在功能上替代 Goal 与 Plan，使用独立命令命名空间（暂定 `/task`）及自有模型工具、状态和 UI；不覆盖或要求卸载原生插件，不依赖其私有服务。
- 同一会话只由一个控制器负责续行；首版以专用 preset 和新的督导会话隔离任务控制，不能把独立命令名当成避免运行冲突的充分条件。
- 每会话维护有上限的未结束任务列表，同时只准入一个任务执行。JSON 是会话事件的可重建快照，不建立第二份权威历史。
- 关闭 Supervisor 必须使续行、审查和超时回调失效；重新启用不自动恢复任务。阶段审查聚焦目标、约束、进展和完成证据。
- 插件拥有持久任务状态、执行计划、续行和完成裁决。主 Agent 执行任务并提出计划变更；独立审查者读取主会话证据，不能代替主 Agent 修改工作区。
- 任何送入模型的插件消息都必须能从持久 session 事件重建。注册、监听和清理遵循 Cordis effect 生命周期。
- 首次自主多轮执行默认由用户确认任务要求与初始计划。用户可通过 profile 或任务设置明确预授权当前要求版本的首次执行，但正式计划必须通过独立覆盖审查；记录授权来源与审查作业，不伪造用户消息。编辑要求或撤销使原预授权失效。用户后续指令不需要额外“同步确认”；宿主重启等待手动继续，完成后修复每次点击确认。
- 在隔离 DSH 实例验收；不修改日常 DSH profile，也不改旧原型 `../dsh-jev-verifier/`。
- 主 Agent 保持执行身份，督导控制层负责确定性调度与状态；审查者不充当通用 Lead 或实施 Worker。持久化不是相对于 Team 的独有优势。
- 先以真实长任务数据和独立验收建立基线，再声称优于 DSH Goal 或 Plan；同时比较明确要求审查的 Lead–Worker Team。

恢复、动作交付与日志读取按[督导会话设计](docs/session-runtime.zh.md)执行；影响控制的记录不得为了可读而标为 `ignorable`。审查默认跟随主 Agent，也可从当前 DSH profile 指定模型，详见[审查模型](docs/review-model.zh.md)。

## DSH 本地 Skills

DSH 源码仓库的 13 个 skill 已从仓库根目录的 `.agents/skills/` 通过共享 `skills/` 软链接访问。涉及文档、测试、审查与发布时，按任务范围读取对应 skill；不要把 DSH 的 skill 内容复制进本项目。

## 当前状态

当前版本使用公开 DSH 原生 Inbox 记录与 Agent preset，不要求私有 Host 扩展。原生控制记录不得进入模型对话或标记为 `ignorable`；插入与取消交付必须同步完成，防止破坏工具调用／结果配对。0.1.0 的旧扩展日志继续使用原宿主，本版本不改写历史日志。[安装验收](docs/native-install.zh.md)记录公开发行版测试与边界，[实现状态](docs/implementation.zh.md)区分已运行代码与后续设计。
