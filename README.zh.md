# DSH 长任务督导

**已有可运行的原生原型，尚未发布为正式插件。** 本项目在 DSH Goal 和 Plan 旁提供独立的 `/task` 工作流。主 Agent 在原生 Session 中规划和执行；确定性的控制层拥有任务状态与续行权，每次进展、阶段和完成检查都启动新的只读审查 Agent。审查者提出建议，不能直接改工作区或任务状态。

原型目前需要一项小范围 DSH 宿主扩展，支持持久的 `extension/record` 事件及读取器准入。扩展位于隔离 DSH 工作树，尚未合入标准 DSH。安装前请先看[实现状态](docs/implementation.zh.md)。

## 当前流程

1. `/task new <目标>` 创建一个受督导任务，要求主 Agent 用 `task_submit_plan` 提交验收标准和有序阶段。
2. `/task` 查看状态。提交计划时先由独立审查者检查原始目标的覆盖情况；遗漏要求会退回修订。初始计划通过审查后，等待 `/task approve` 或右侧面板的**批准计划**按钮。规划阶段沿用 DSH 原生工具权限，可通过 `run_code`、文件和命令工具勘察工作区；提示主 Agent 在批准前不实施交付物。`/task new` 的原始命令按原生用户消息记录并展示。
3. 获批后，控制层准入后续轮次。主 Agent 用 `task_report_stage` 汇报阶段证据；新的审查者分页读取主 Session 的有界日志，返回通过、修订或需要用户决策。
4. 达到可配置的未汇报轮次后，进展审查决定继续、纠偏或暂停请用户处理。所有阶段通过后，`task_request_completion` 启动独立的最终审查；只有最终审查通过才能记为完成。
5. `/task pause`、`/task off`、`/task on`、`/task resume`、`/task edit <目标>`、`/task clear` 控制生命周期。计划、阶段和完成检查点分别显示主 Agent 提交和 Supervisor 的独立审查，附事件序号及审查 Session 身份。两方的后续内容可分别展开。右侧面板显示状态和对应按钮，包括明确的**关闭督导**按钮。宿主重启后恢复任务，但等待用户手动继续。
6. 已完成任务发现原目标缺陷时，通过 `task_propose_repair` 或督导对话提出影响范围，每次由用户在侧栏点击确认后回到同一任务与原 DAG。未确认不实施；历史验收保留，受影响节点重新审查。详见[完成后修复协议](docs/completed-task-repair.zh.md)与[验收记录](docs/completed-task-repair-validation.zh.md)。

主 Session 和当前任务的督导对话均可输入 `/task` 命令；侧栏中的命令转交主 Session 的同一控制器。督导对话中的普通问题不改变任务，明确输入“暂停任务”“恢复任务”或任务完成后的“新建任务：完整目标”才会转交控制。新任务或暂停状态出现时，主会话打开侧栏的“任务详情”；旧任务的督导对话保留为历史，不能操作新任务。督导对话的输入框固定在侧栏底部，任务按钮位于“任务详情”Tab。

同一个主 Session 可在任务完成后继续创建下一项。侧栏右上角“历史任务”从原生 Session 记录按需读取已完成或已清除的任务，保留目标、计划、节点和审查记录的只读视图；列表中的“新建任务”提交到同一 `/task new` 控制器。主 Session 的小 DAG 只跟随当前任务。完成状态直接显示结果，不再主动提供“清除任务”按钮；需要主动取消未完成任务时仍可使用 `/task clear`。

任务若要求批准后先完成只读模型轮次，计划可设置 `read_only_turns_before_write`（0–10）。控制层在足够数量的已完成只读轮次出现前阻止写入；中断轮次不计入。该门禁针对这类明确的动作顺序约束，不会自动把任意自然语言时序要求编译成规则。

主 Agent 在实施节点前用 `task_start_node` 登记节点与尝试编号；普通问询不产生开始记录。返工以成功的 `task_rework_node` 调用为依据，主会话保留返工通知，DAG 展示“待返工／返工中”及尝试次数。节点详情保留原因、此前通过的审查及受影响的依赖节点；旧会话可从原生工具日志重建这些记录。已通过的旧尝试不代表新尝试通过。记录缺失时只展示已知状态，不推测主 Agent 正在执行哪个节点。

审查模型默认跟随主 Agent 当前有效的 DSH 路由。也可通过 `reviewerModel` 指定当前 profile 可用的提供方、模型和推理等级。每次审查记录实际模型、审查 Session ID、证据 seq 和主 Session 截止点。

独立检查默认关闭。配置 `independentVerification` 后，节点与整体验收先读取当前产物快照并执行自己的检查，再对照主 Agent 汇报；运行时标准需要独立执行证据。当前提供插件内 Docker 后端，独立浏览器检查待开发。配置与限制见[实现状态](docs/implementation.zh.md#独立产物检查与两阶段审查)，真实正反例见[验收记录](docs/independent-verification-validation.zh.md)。

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
| [督导对话与审查恢复方案](docs/10-plans/conversation-and-review-recovery/plans.zh.md) | 待实现：从讨论形成任务、有限协议补交、故障追踪和审查频率实验。 |
| [V2 联合验收](docs/v2-integrated-validation.zh.md) | 第二、三批的真实模型、DAG、持续侧问、原生并行与失败修复记录。 |
| [返工与执行状态验收](docs/rework-progress-validation.zh.md) | 主节点显式开始、此前通过、下游影响与旧日志恢复。 |
| [独立验收与完成后返工方案](docs/10-plans/independent-verification/plans.zh.md) | 完成后修复、快照与两阶段独立运行已验收；独立浏览器与联合回归仍待开发。 |
| [架构](docs/architecture.zh.md) | 职责与 DSH 集成设计。 |
| [任务状态与控制](docs/task-lifecycle.zh.md) | 完整多任务生命周期提案。 |
| [审查与介入](docs/review-policy.zh.md) | 审查时机与用户决策。 |
| [规划监督与截断恢复提案](.agents/notes/proposed/feature/2026-09-29-planning-supervision.zh.md) | 待实现：规划形成期间的观察、有上下文的有限续行与用户可选的自动执行批准。 |
| [评测设计与执行路线](docs/evaluation.zh.md) | 公开基准优先；统一数据集、对照组、指标、待办与开发结果入口。 |
| [首个原型](docs/prototype.zh.md) | 验收条件与 Agent Team 比较。 |
| [督导会话](docs/session-runtime.zh.md) | 持久控制与恢复设计。 |
| [审查模型](docs/review-model.zh.md) | DSH profile 模型策略。 |
| [内核技术试验](docs/host-spike.zh.md) | 最初的能力调研。 |

当前原型每个 Session 同时只执行一个任务，结束后可连续创建后续任务。五任务并行队列、`/task plan` 快捷入口、用户可配置的决策超时以及正式长程对照评测仍属后续设计。开发试跑曾发现违反原始时序约束却被误判完成；[独立回归样例](eval/reliability-v1/README.zh.md)和真实模型恢复测试记录了修复后的证据。原生 Goal 和 Plan 保留自己的命令；建议用专门的受督导 Session，避免两个续行控制器同时管理同一任务。

[English](README.md)

持久督导问询复用原生 Session 和压缩后端。在采用根作用域工具的专用隔离 Web profile 中，需要启用原生 `compaction-basic` 与 `command-compact` 行；Web 默认把它们移到 Agent preset，裸根 Session 不会自动获得它们。先确认命令菜单提供 `/compact`，并以持久 `command/done` 和 `compaction/summary` 为成功依据；把 `/compact` 当普通消息发送不构成压缩。使用 preset 的宿主应在相应作用域提供同一原生能力，不能同时挂载两份压缩后端。
