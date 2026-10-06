---
description: "为 DSH Web profile 添加持久任务、计划审查与督导对话。"
kind: "package-bundle"
---

# DSH 长任务督导

## 概述

**给 DSH 的长任务加上计划审查、进度追踪和完成验收。** 主 Agent 负责规划与执行，Supervisor 持久保存任务状态，并在规划、阶段和完成检查点启动独立审查 Session。你可以从主会话的小 DAG 看进度，在侧栏查看计划、审查依据并与督导对话。

[English](README.md) · [npm 0.1.1](https://www.npmjs.com/package/dsh-task-supervisor) · [反馈问题](https://github.com/gosomea/dsh-task-supervisor/issues) · [社区交流](https://github.com/deepseek-ai/deepseek-harness/discussions/8892)

**0.1.1 开发预览。** 使用独立的 `/task` 工作流，与 DSH 原生 Goal 和 Plan 共存；任务状态与续行由确定性的控制器管理，审查者提供判断。默认审查主 Session 日志；独立产物读取和隔离命令检查需要显式配置。

## 安装前提

本版本可安装到未经修改的公开 DSH，采用原生 Session 记录和 Agent preset 实现持久化与执行准入，无需 Host 补丁或自行构建。已验证版本及迁移限制见[安装验收](docs/native-install.zh.md)。

## 可以用它做什么

- **计划先审查再执行**：核对原始要求的覆盖情况，默认由用户批准，也可明确预授权审查通过后执行。
- **看清进度和返工**：DAG 展示节点状态、参与 Agent 和尝试次数，保留返工原因与受影响的依赖节点。
- **随时询问督导**：在侧栏讨论目标、询问当前进展，或明确暂停、恢复和关闭督导。
- **完成之后仍可修复**：先展示影响范围，经用户点击确认，回到原任务与 DAG，保留此前验收记录。

![主会话 DAG 与侧栏返工详情](docs/assets/rework-attempt-details.png)

*此前隔离验收的界面示例，展示“已通过 → 新尝试返工”的记录与依赖影响。*

## 安装与版本范围

使用 Node 24 和官方 DSH `0.2.0-rc.2`，沿用 Web profile 与现有模型配置。将 bundle 加入该 profile 后启动 DSH：

```sh
dsh plugin --profile web add dsh-task-supervisor@0.1.1
dsh web
```

npm 0.1.1 包包含预构建的 Host 插件、Web 客户端、检查网关和 bundle patch，仍使用专用 Supervisor preset。当前开发源码已改为原生模式内创建 Task，并保留 Goal／Plan 工具；这轮尚未发布。自然语言创建、续行协调及旧 Session 恢复见[原生模式中的任务督导](docs/native-task.zh.md)。

独立命令检查若修改捕获的产物树，本次证据失效，后续检查会被拒绝；自动恢复检查目录尚未验收。本版本保留该限制。默认审查主 Session 日志；独立产物检查需要显式配置，独立浏览器观察尚不可用。详见[实现状态](docs/implementation.zh.md)。

## 规划监督

规划监督默认开启（`planningSupervision`；`maxPlanningWithoutProgress: 2`）。尚无正式计划时，在原生步骤边界复用已有活动观察阈值；正常规划轮结束而未提交计划，或恢复后再次截断，也会请求独立规划审查。带证据的事实、未决问题和下一步绑定要求版本；通过只允许继续规划。用户决定、内部恢复耗尽和连续独立判定的无进展分别以不同原因暂停。关闭 `automaticContinuation` 不开新轮；关闭 `observeLongTurns` 不在轮内观察，`planningSupervision: false` 则完全关闭规划审查。

## 当前流程

1. `/task <目标>` 创建受督导任务并开始规划。单独 `/task` 等待下一条用户消息作为目标，不调用模型；`/task off` 取消入口。`/task new <目标>` 保留为兼容别名。
2. `/task status` 查看状态；已有未结束任务时，单独 `/task` 也查看当前任务，不恢复执行。提交计划时先由独立审查者检查原始目标的覆盖情况；遗漏要求会退回修订。初始计划通过审查后，默认等待 `/task approve` 或右侧面板的**批准计划**按钮；明确 `after-review` 预授权后自动准入执行。规划阶段沿用 DSH 原生工具权限，可通过 `run_code`、文件和命令工具勘察工作区；提示主 Agent 在批准前不实施交付物。`/task <目标>` 的原始命令按原生用户消息记录并展示。
3. 获批后，控制层准入后续轮次。主 Agent 用 `task_report_stage` 汇报阶段证据；新的审查者分页读取主 Session 的有界日志，返回通过、修订或需要用户决策。
4. 达到可配置的未汇报轮次后，进展审查决定继续、纠偏或暂停请用户处理。所有阶段通过后，`task_request_completion` 启动独立的最终审查；只有最终审查通过才能记为完成。
5. `/task pause`、`/task off`、`/task on`、`/task resume`、`/task edit <目标>`、`/task clear` 控制生命周期。计划、阶段和完成检查点分别显示主 Agent 提交和 Supervisor 的独立审查，附事件序号及审查 Session 身份。两方的后续内容可分别展开。右侧面板显示状态和对应按钮，包括明确的**关闭督导**按钮。宿主重启后恢复任务，但等待用户手动继续。
6. 已完成任务发现原目标缺陷时，通过 `task_propose_repair` 或督导对话提出影响范围，每次由用户在侧栏点击确认后回到同一任务与原 DAG。未确认不实施；历史验收保留，受影响节点重新审查。详见[完成后修复协议](docs/completed-task-repair.zh.md)与[验收记录](docs/completed-task-repair-validation.zh.md)。

主 Session 和当前任务的督导对话均可输入 `/task` 命令；侧栏中的命令转交主 Session 的同一控制器。督导对话中的普通问题不改变任务，明确输入“暂停任务”“恢复任务”或任务完成后的“新建任务：完整目标”才会转交控制。新任务或暂停状态出现时，主会话打开侧栏的“任务详情”；旧任务的督导对话保留为历史，不能操作新任务。督导对话的输入框固定在侧栏底部，任务按钮位于“任务详情”Tab。

同一个主 Session 可在任务完成后继续创建下一项。侧栏右上角“历史任务”从原生 Session 记录按需读取已完成或已清除的任务，保留目标、计划、节点和审查记录的只读视图；督导对话整理草案并通过同一任务控制器创建。主 Session 的小 DAG 只跟随当前任务。完成状态直接显示结果，不再主动提供“清除任务”按钮；需要主动取消未完成任务时仍可使用 `/task clear`。

任务若要求批准后先完成只读模型轮次，计划可设置 `read_only_turns_before_write`（0–10）。控制层在足够数量的已完成只读轮次出现前阻止写入；中断轮次不计入。该门禁针对这类明确的动作顺序约束，不会自动把任意自然语言时序要求编译成规则。

主 Agent 在实施节点前用 `task_start_node` 登记节点与尝试编号；普通问询不产生开始记录。返工以成功的 `task_rework_node` 调用为依据，主会话保留返工通知，DAG 展示“待返工／返工中”及尝试次数。节点详情保留原因、此前通过的审查及受影响的依赖节点；旧会话可从原生工具日志重建这些记录。已通过的旧尝试不代表新尝试通过。记录缺失时只展示已知状态，不推测主 Agent 正在执行哪个节点。

审查模型默认跟随主 Agent 当前有效的 DSH 路由。也可通过 `reviewerModel` 指定当前 profile 可用的提供方、模型和推理等级。每次审查记录实际模型、审查 Session ID、证据 seq 和主 Session 截止点。

默认按主 Session 日志审查。新配置显式设定 `reviewVerification: independent` 并提供 `independentVerification.storageRoot`，启用要求驱动的检查方案与两阶段产物验收；只需读取的要求不必配置命令运行器，需要复算或行为验证时才配置容器与工具链。仅保留旧 `independentVerification` 配置时仍采用旧协议，不补造历史检查方案。独立浏览器检查尚不可用。配置见[实现状态](docs/implementation.zh.md#独立产物检查与两阶段审查)，当前真实模型验收见[通用审查记录](eval/independent-verification/generic-quality-20260930/README.zh.md)。

生成达到单次输出上限时，`truncationRecovery` 默认开启，在当前任务准入有效且原生工具与队列已结清后恢复规划或执行。`automaticContinuation: false` 关闭自动新轮次；`maxRecoveryWithoutProgress` 默认 2，连续恢复没有新的可核实工具产出会暂停等待手动恢复。恢复消息、原回合、证据和计数保存在主 Session；暂停、关闭及重启不会自动恢复。

`planningSupervision` 默认 `true`，在提交前检查计划形成。`executionApproval` 默认 `manual`；可在 profile 选择 `after-review`，或首次批准前用 `/task auto-approve-on`，预授权正式计划通过独立审查后执行。`/task auto-approve-off` 撤销此项，审查进行中也可撤销。编辑要求会清除批准和预授权。[验收记录](docs/planning-supervision-validation.zh.md)区分确定性检查和真实模型探针。

## 开发与隔离验证

使用 Node 24 和已安装依赖、未经修改的 DSH 源码 checkout 进行源码测试。下列命令只读取该 checkout，不构建或修改它；`DSH_SOURCE` 指定路径：

```sh
pnpm install
pnpm run build
DSH_SOURCE=/absolute/path/to/deepseek-harness node spikes/kernel/typecheck.mjs
DSH_SOURCE=/absolute/path/to/deepseek-harness node spikes/kernel/run.mjs
pnpm pack --dry-run
```

安装验收使用官方 npm DSH 和登记的独立 `DSH_HOME`，通过 `dsh plugin --profile web add /absolute/path/to/package.tgz` 安装打包产物。无需构建源码 Host／Client、手动链接 SDK 或私有事件读取器 API。原生组件作为 peer dependency 由 DSH 提供，插件不会用另一个版本替换 Host 组件。

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
| [规划监督与执行批准](.agents/notes/implemented/feature/2026-09-29-planning-supervision.zh.md) | 已实现：规划观察、上下文恢复、有限审查补交与明确执行预授权；链接包含证据与限制。 |
| [评测设计与执行路线](docs/evaluation.zh.md) | 公开基准优先；统一数据集、对照组、指标、待办与开发结果入口。 |
| [首个原型](docs/prototype.zh.md) | 验收条件与 Agent Team 比较。 |
| [督导会话](docs/session-runtime.zh.md) | 持久控制与恢复设计。 |
| [审查模型](docs/review-model.zh.md) | DSH profile 模型策略。 |
| [内核技术试验](docs/host-spike.zh.md) | 最初的能力调研。 |

当前原型每个 Session 同时只执行一个任务，结束后可连续创建后续任务。五任务并行队列、`/task plan` 快捷入口、用户可配置的决策超时以及正式长程对照评测仍属后续设计。开发试跑曾发现违反原始时序约束却被误判完成；[独立回归样例](eval/reliability-v1/README.zh.md)和真实模型恢复测试记录了修复后的证据。原生 Goal 和 Plan 在普通模式中保留；生成的 Supervisor preset 只在督导 Session 中停用它们的工作流行。profile preset 编辑在重启 Host 后的新 Supervisor 组合中生效。

[English](README.md)

## 模型体验

主 Agent 通过 `/task` 与任务工具工作，原始输入和模型回答保持原生展示；审查者使用有界证据与受限检查工具。单独创建审查 Session 不代表已经独立运行或观察产物；面板显示实际生效的验证模式。督导问询与压缩继承原生 preset 的能力，无需另外挂载根作用域压缩后端。

## 当前限制

0.1.0 私有扩展日志不能直接在公开 DSH 中恢复，请保留原宿主并新建 0.1.1 Session。本次不迁移或重写历史日志。已开始的普通 Session 不能转换为 Supervisor；新建时先选模式。同一 Session 的后续任务保留此前历史。独立浏览器与检查目录自动恢复尚未实现，安装验收不证明长程性能优于 Goal／Plan。
