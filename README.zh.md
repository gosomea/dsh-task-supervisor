# DSH 长任务督导

**已有可运行的原生原型，尚未发布为正式插件。** 本项目在 DSH Goal 和 Plan 旁提供独立的 `/task` 工作流。主 Agent 在原生 Session 中规划和执行；确定性的控制层拥有任务状态与续行权，每次进展、阶段和完成检查都启动新的只读审查 Agent。审查者提出建议，不能直接改工作区或任务状态。

原型目前需要一项小范围 DSH 宿主扩展，支持持久的 `extension/record` 事件及读取器准入。扩展位于隔离 DSH 工作树，尚未合入标准 DSH。安装前请先看[实现状态](docs/implementation.zh.md)。

## 当前流程

1. `/task new <目标>` 创建一个受督导任务，要求主 Agent 用 `task_submit_plan` 提交验收标准和有序阶段。
2. `/task` 查看状态。提交计划时先由独立审查者检查原始目标的覆盖情况；遗漏要求会退回修订。初始计划通过审查后，等待 `/task approve` 或右侧面板的**批准计划**按钮。规划期间由执行器限制修改工作区的工具。
3. 获批后，控制层准入后续轮次。主 Agent 用 `task_report_stage` 汇报阶段证据；新的审查者分页读取主 Session 的有界日志，返回通过、修订或需要用户决策。
4. 达到可配置的未汇报轮次后，进展审查决定继续、纠偏或暂停请用户处理。所有阶段通过后，`task_request_completion` 启动独立的最终审查；只有最终审查通过才能记为完成。
5. `/task pause`、`/task off`、`/task on`、`/task resume`、`/task edit <目标>`、`/task clear` 控制生命周期。计划、阶段和完成检查点分别显示主 Agent 提交和 Supervisor 的独立审查，附事件序号及审查 Session 身份。两方的后续内容可分别展开。右侧面板显示状态和对应按钮，包括明确的**关闭督导**按钮。宿主重启后恢复任务，但等待用户手动继续。

任务若要求批准后先完成只读模型轮次，计划可设置 `read_only_turns_before_write`（0–10）。控制层在足够数量的已完成只读轮次出现前阻止写入；中断轮次不计入。该门禁针对这类明确的动作顺序约束，不会自动把任意自然语言时序要求编译成规则。

审查模型默认跟随主 Agent 当前有效的 DSH 路由。也可通过 `reviewerModel` 指定当前 profile 可用的提供方、模型和推理等级。每次审查记录实际模型、审查 Session ID、证据 seq 和主 Session 截止点。

## 开发与隔离验证

使用 Node 24 和包含 `extension/record` 宿主接缝的隔离 DSH checkout。日常 DSH checkout 与 profile 不需要修改。测试脚本通过 `DSH_SOURCE` 定位该工作树：

```sh
pnpm install
pnpm run build
DSH_SOURCE=/absolute/path/to/isolated-deepseek-harness node spikes/kernel/typecheck.mjs
DSH_SOURCE=/absolute/path/to/isolated-deepseek-harness node spikes/kernel/run.mjs
pnpm pack --dry-run
```

Web 冒烟测试需先构建隔离 checkout 的 Host 与 Client，以单独的 `DSH_HOME` 初始化 Web profile，再用 DSH 的 `plugin add` 安装 `link:/absolute/path/to/dsh-task-supervisor`。bundle patch 注册宿主插件，包清单注册 Web 客户端。[实现状态](docs/implementation.zh.md)列出已验证层级和当前限制。

## 设计与评测

| 阅读 | 用途 |
| --- | --- |
| [实现状态](docs/implementation.zh.md) | 实际代码、安装前提、测试与限制。 |
| [督导交互改进提案](docs/supervisor-experience-v2.zh.md) | 神社 Session 核对、响应语言、任务图、用户决策与持久侧问。 |
| [V2 联合验收](docs/v2-integrated-validation.zh.md) | 第二、三批的真实模型、DAG、持续侧问、原生并行与失败修复记录。 |
| [架构](docs/architecture.zh.md) | 职责与 DSH 集成设计。 |
| [任务状态与控制](docs/task-lifecycle.zh.md) | 完整多任务生命周期提案。 |
| [审查与介入](docs/review-policy.zh.md) | 审查时机与用户决策。 |
| [评测](docs/evaluation.zh.md)与[开发试跑](eval/pilot-v1/results-20260926.zh.md) | 长程评测协议及 Goal、Plan、Supervisor 的两题试跑。 |
| [Eval Notes：近期评测重点](docs/notes-eval.zh.md) | 公开测试集优先、首轮必需指标、自动化产物及后续多任务 Session。 |
| [首个原型](docs/prototype.zh.md) | 验收条件与 Agent Team 比较。 |
| [督导会话](docs/session-runtime.zh.md) | 持久控制与恢复设计。 |
| [审查模型](docs/review-model.zh.md) | DSH profile 模型策略。 |
| [内核技术试验](docs/host-spike.zh.md) | 最初的能力调研。 |

当前原型每个 Session 支持一个任务。五任务队列、`/task plan` 快捷入口、插件内置的独立可执行验收、用户可配置的决策超时以及正式长程对照评测仍属后续设计。开发试跑曾发现违反原始时序约束却被误判完成；[独立回归样例](eval/reliability-v1/README.zh.md)和真实模型恢复测试记录了修复后的证据。原生 Goal 和 Plan 保留自己的命令；建议用专门的受督导 Session，避免两个续行控制器同时管理同一任务。

[English](README.md)

持久督导问询复用原生 Session 和压缩后端。在采用根作用域工具的专用隔离 Web profile 中，需要启用原生 `compaction-basic` 与 `command-compact` 行；Web 默认把它们移到 Agent preset，裸根 Session 不会自动获得它们。先确认命令菜单提供 `/compact`，并以持久 `command/done` 和 `compaction/summary` 为成功依据；把 `/compact` 当普通消息发送不构成压缩。使用 preset 的宿主应在相应作用域提供同一原生能力，不能同时挂载两份压缩后端。
