# 实现状态

本文记录截至 2026-09-26 可运行原型的实际能力。其余设计文档描述目标产品，其中有些行为尚未由当前构建实现。

## 原生集成

宿主入口是 [`src/index.ts`](../src/index.ts)：注册 `/task`、四个模型工具、生命周期监听器、工具执行保护和可选的 Web 路由。Web 客户端位于 [`src/client/index.tsx`](../src/client/index.tsx)，挂载到 DSH 右侧边栏标签，通过 Connection 已认证的 `/api/task-supervisor` Fetch 路由读取和控制绑定任务。客户端把计划提交、阶段审查和完成审查的成功工具结果投影到原生对话轮次尾部。计划显示为主 Agent 提交；阶段和完成检查点分成主 Agent 提交与 Supervisor 独立审查两张卡，分别注明主 Session 事件序号、审查 Session 身份，后续内容分别展开。即使 DSH 折叠执行过程，卡片仍可见。卡片只读取已有 Session 事件，不写入新的模型回复。该路由不另开监听端口，返回由 Session 派生的状态。已关闭的 Session 可用有界的持久层分页读取；控制操作需要存活的 Agent。

任务记录作为 `extension/record` 事件保存在主 DSH Session。[`src/state.ts`](../src/state.ts)校验并折叠每次转换的完整状态。审查者使用自己的原生子 Session；主记录保存审查 Session ID、实际模型、证据 seq 和固定的主日志截止点。审查者持有绑定主 Session 的 `read_task_evidence`：每页最多 30 个事件，正文限长，并脱敏常见密钥模式。工具保护拒绝其他审查工具。主 Session 文本是证据，不能成为审查者的指令。

配套的宿主变更位于隔离的 `deepseek-harness-supervisor-seam` 工作树。它增加原生、仅记录日志的 `extension/record` 事件，以及按 Cordis effect 生命周期注册的 `registerSessionControlReader(namespace, versions)` 准入检查；恢复时和领取每一步 inbox 输入前都会检查。缺少兼容读取器时，受控 Session 拒绝执行。这是当前必需的 DSH 前置扩展，尚非已发布的公共接缝；标准 DSH 构建目前不能安全运行此原型。

## 控制行为

初始计划需要一次明确批准。等待批准期间，主 Agent 可再次调用 `task_submit_plan` 替换整份待审批计划；批准始终作用于最新计划版本。规划期间的工具权限在执行器处限制。之后 `/task edit` 使旧计划失效并要求主 Agent 提交完整修订，不重复请求批准。已批准工作在每轮空闲后继续。`maxAutomaticRoundsWithoutReport` 默认三轮；到期由新的进展审查者决定继续、修订或请用户决策。阶段报告和最终完成申请各启动新审查。只有最终审查的通过裁决才转为 `complete`。

任务状态和督导消息先刷入持久层，之后才唤醒 Agent。重启时恢复投影，移除过期的督导消息；执行仍保持停用，直到 `/task resume` 或面板恢复按钮。中断的审查把已提交证据保存在持久状态中；手动恢复后要求主 Agent 核对当前副作用并重新提交审查。`/task off` 取消自有工作但保留任务记录；`/task on` 不自动恢复。督导清理旧消息时不删除用户输入。

## 已执行验证

- 隔离 DSH 宿主严格类型检查与两项定向测试通过，覆盖缺少兼容读取器时拒绝恢复，以及卸载读取器后下一步准入拒绝。
- 使用真实 DSH 服务和脚本化模型的十九项内核测试通过。其中九项督导集成测试覆盖计划批准保护、持久状态与手动恢复、进展审查通过后的自动续行与需要用户决策的暂停、中断审查恢复、关闭与重启用、`clear` 撤销排队工作、fork 不继承执行权限、阶段审查及最终完成。脚本化模型只证明控制链和安全门禁，不证明审查质量。
- 隔离宿主 `doc-sync` 的 42 项检查全部通过；新增持久事件有中英文同版本变更记录。
- Node 24 打包与 `pnpm pack --dry-run` 包含宿主 bundle patch 和 Web 客户端。在独立 `DSH_HOME` 中，DSH 的 `plugin add link:` 安装成功，`--dump-config` 出现已启用的插件行。
- 隔离 DSH Web 宿主挂载了客户端。通过真实输入框创建的任务显示在右侧面板；面板的**关闭督导**和重新启用按钮改变原生 Session 状态；宿主重启后，任务重新出现，面板提供手动**恢复任务**按钮。
- 将真实 `spec-parser` Session 在隔离 Web 宿主重新打开后，首轮显示一张主 Agent 计划卡，后四轮分别显示主 Agent 提交和 Supervisor 独立审查两张卡；审查 Session ID 与双方事件序号可见，剩余内容可分别展开。
- 使用日常 profile 首个 CodeBuddy 模型的真实请求，验证自动续行、默认三轮未汇报时的进展审查、阶段与完成审查，以及关闭和宿主重启后的手动恢复。两题三组的[开发试跑](../eval/pilot-v1/results-20260926.zh.md)用工作区外检查器验收了 Goal、Plan 和 Supervisor；此试跑不能证明长程优势。

## 当前限制

当前每个 Session 只维护一个任务。尚无 `/task plan` 快捷入口、五任务队列、完整的 fork 产品协议、用户决策超时配置或插件内置的可执行产物验收，也未测出优于 Goal、Plan 或 Team 的长程优势。审查者可引用 Session 证据并裁决完成，但模型裁决不等同于独立基准评分。真实模型试跑发现：中断恢复后违反原始目标中的分轮时序要求，却被阶段和最终审查判为通过；审查提示已加强，但仍需真实模型回归。远端请求进行中的取消、Web 控件覆盖每种 Session 生命周期以及正式长任务留出集也尚未验证。隔离宿主扩展尚未成为标准 DSH 的公共接缝。

[English](implementation.md)
