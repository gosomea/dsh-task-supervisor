---
title: "V2 第一批隔离验收"
description: "中文响应、文字与按钮批准、主会话控制及暂停恢复的实测记录。"
status: "verified"
date: "2026-09-27"
---

# V2 第一批隔离验收

## 环境与范围

按 `dsh-plugin-isolated-test` 的 SQLite 登记先查询 `supervisor-user` 与 `supervisor-v2`。复用已有 `supervisor-v2`（端口 59909），保留 31973 用户验收部署。沿用原隔离 home、DSH checkout 和独立插件构建副本，没有新建 Host 部署。通过 DSH `workspace/create`、`session/create` 接口绑定 TMP 工作区，再从 Session 元数据核对 cwd；用例与 Session 对应关系写回环境登记。

主 Agent 和审查者实际使用 `deepseek-codebuddy/deepseek-v4.1-flash`，由主 Session 模型投影和审查记录核对。这遵循本机 skill 指定的 CodeBuddy 首模型路由；未修改当前日常 Host 的默认模型。此次只验证第一批控制与 UI，不证明长程审查质量、DAG 或并行能力。

## 中文文字批准与两阶段执行

主 Session：`session-67b9b2c0-8c59-4dcb-afeb-58cffd4cd286`。目标为创建 `greet.mjs` 和 `greet.test.mjs`，实现 trim、空名默认值及非字符串 TypeError，并运行 Node 内置测试。计划明确分为实现和验证两个阶段。

- 先发最小中文请求确认真实模型连通，然后在浏览器输入 `/task new`。
- 计划和独立计划审查均以中文输出。用户消息 seq 48 仅为“批准”，`task_approve` 在模型轮次中执行；状态保存 `lastApproval.planVersion=1`、`userMessageSeq=48`。
- 关闭右侧栏时，主会话任务块可查看全部阶段、详情和验收标准，并执行暂停/恢复。第二阶段审查期间暂停，状态变为 `paused`；手动恢复后重新审查，最终 revision 14、`complete`、2/2 阶段通过。
- 最终完成审查保存在主 Session seq 146，独立审查 Session 为 `task-review-57685a2c-5ed8-4025-a1ec-0a42a5f35cb6`。主 Agent 提交和 Supervisor 结论分卡展示，完成状态块位于输入框上方。
- 工作区外另行运行 `node --test greet.test.mjs`：5 个测试通过，0 失败。

## 按钮批准与中断提示

主 Session：`session-1bd863f2-dd19-45bf-bfcf-81438e64c563`。在同一部署下另建干净 TMP 用例目录，目标为只创建一个内容为“隔离环境复用成功”的 `status.txt`。

- 从主会话任务块点击“批准计划”，进入执行阶段。
- 审查期间同时打开侧栏，两处均显示“暂停”，没有“恢复任务”按钮；暂停后两处均显示恢复。
- 从主会话恢复后，最近审查提示为“审查尚未完成；恢复后请重新提交证据。”，修复了控制层生成英文提示的问题。
- 最终 revision 12、`complete`、1/1 阶段通过。工作区外核验目录仅含 `status.txt`，且文件内容精确为“隔离环境复用成功”。

## 自动检查与修复

34 项测试通过，使用真实 DSH 服务与脚本化模型验证控制链，并覆盖客户端请求顺序。包括直接用户批准来源、模型轮次内批准只续行一次、旧版本动作拒绝、双击合并，以及旧挂载的延迟请求不能启动第二条轮询。严格类型检查和独立副本构建通过。

浏览器验收发现统计栏与展开任务块同排，改用原生 `conversation.input.dock` 全宽插槽，并限制展开高度。侧栏与主会话继续共享状态仓库；折叠时不遮挡模型报告。原始模型推理仍可能为英文，插件只约束用户可见报告与系统提示；该次实测不代表每种语言都已验证。

[English](v2-batch1-validation.md)
