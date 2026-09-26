# 实现状态

本文记录截至 2026-09-24 可运行原型的实际能力。其余设计文档描述目标产品，其中有些行为尚未由当前构建实现。

## 原生集成

宿主入口是 [`src/index.ts`](../src/index.ts)：注册 `/task`、四个模型工具、生命周期监听器、工具执行保护和可选的 Web 路由。Web 客户端位于 [`src/client/index.tsx`](../src/client/index.tsx)，挂载到 DSH 右侧边栏标签，通过 Connection 已认证的 `/api/task-supervisor` Fetch 路由读取和控制绑定任务。该路由不另开监听端口，返回由 Session 派生的状态。已关闭的 Session 可用有界的持久层分页读取；控制操作需要存活的 Agent。

任务记录作为 `extension/record` 事件保存在主 DSH Session。[`src/state.ts`](../src/state.ts)校验并折叠每次转换的完整状态。审查者使用自己的原生子 Session；主记录保存审查 Session ID、实际模型、证据 seq 和固定的主日志截止点。审查者持有绑定主 Session 的 `read_task_evidence`：每页最多 30 个事件，正文限长，并脱敏常见密钥模式。工具保护拒绝其他审查工具。主 Session 文本是证据，不能成为审查者的指令。

配套的宿主变更位于隔离的 `deepseek-harness-supervisor-seam` 工作树。它增加原生、仅记录日志的 `extension/record` 事件，以及按 Cordis effect 生命周期注册的 `registerSessionControlReader(namespace, versions)` 准入检查；恢复时和领取每一步 inbox 输入前都会检查。缺少兼容读取器时，受控 Session 拒绝执行。这是当前必需的 DSH 前置扩展，尚非已发布的公共接缝；标准 DSH 构建目前不能安全运行此原型。

## 控制行为

初始计划需要一次明确批准。等待批准期间，主 Agent 可再次调用 `task_submit_plan` 替换整份待审批计划；批准始终作用于最新计划版本。规划期间的工具权限在执行器处限制。之后 `/task edit` 使旧计划失效并要求主 Agent 提交完整修订，不重复请求批准。已批准工作在每轮空闲后继续。`maxAutomaticRoundsWithoutReport` 默认三轮；到期由新的进展审查者决定继续、修订或请用户决策。阶段报告和最终完成申请各启动新审查。只有最终审查的通过裁决才转为 `complete`。

任务状态和督导消息先刷入持久层，之后才唤醒 Agent。重启时恢复投影，移除过期的督导消息；执行仍保持停用，直到 `/task resume` 或面板恢复按钮。中断的审查把已提交证据保存在持久状态中；手动恢复后要求主 Agent 核对当前副作用并重新提交审查。`/task off` 取消自有工作但保留任务记录；`/task on` 不自动恢复。督导清理旧消息时不删除用户输入。

## 已执行验证

- 隔离 DSH 宿主严格类型检查与两项定向测试通过，覆盖缺少兼容读取器时拒绝恢复，以及卸载读取器后下一步准入拒绝。
- 使用真实 DSH 服务和脚本化模型的十六项测试通过。其中六项督导集成测试覆盖计划批准保护、持久状态与手动恢复、进展审查通过后的自动续行与需要用户决策的暂停、中断审查恢复、关闭与重启用、阶段审查及最终完成。脚本化模型只证明控制链和安全门禁，不证明审查质量。
- 隔离宿主 `doc-sync` 的 42 项检查全部通过；新增持久事件有中英文同版本变更记录。
- Node 24 打包与 `pnpm pack --dry-run` 包含宿主 bundle patch 和 Web 客户端。在独立 `DSH_HOME` 中，DSH 的 `plugin add link:` 安装成功，`--dump-config` 出现已启用的插件行。
- 隔离 DSH Web 宿主挂载了客户端。通过真实输入框创建的任务显示在右侧面板；面板的**关闭督导**和重新启用按钮改变原生 Session 状态；宿主重启后，任务重新出现，面板提供手动**恢复任务**按钮。隔离 profile 没有模型凭据，因此本轮 Web 测试未验证真实模型判断。

## 当前限制

当前每个 Session 只维护一个任务。尚无 `/task plan` 快捷入口、五任务队列、fork 协议、用户决策超时配置、独立可执行产物验收，也未测出优于 Goal、Plan 或 Team 的长程优势。审查者可引用 Session 证据并裁决完成，但模型裁决不等同于设计文档中的独立可执行验收基准。真实模型质量、远端请求进行中的取消、Web 控件覆盖每种 Session 生命周期，以及完整编码 fixture 都还需要验证。隔离宿主扩展与插件修改在审查合并或发布前仍只存在本地。

[English](implementation.md)
