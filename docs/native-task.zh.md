# 原生模式中的任务督导

## 概述

Supervisor 在原生 DSH 模式中创建和管理 Task，不增加模式选择项。标准、PTC、极简和创造模式继续使用原配置。此页描述当前开发源码；npm 0.1.1 仍使用专用 preset，尚未发布这轮改动。

## 创建任务

普通会话中直接运行 `/task <目标>` 即可创建并开始规划。单独 `/task` 持久开启入口，下一条用户消息在首次模型请求前成为任务目标，不创建空任务；`/task off` 取消入口。已有未结束任务时，单独 `/task` 查看原任务，不重开或恢复执行；`/task status` 始终查看状态。`/task new <目标>` 保留为兼容别名。也可明确告诉主 Agent“给自己创建一个 Task”。主 Agent 先用 `task_status` 读取最新用户消息的 seq，再调用 `task_create`。该工具绑定真实用户消息，保留原始要求并返回实际 Task ID。插件消息、伪造序号和过期用户消息不能作为创建依据。重复提交同一来源和目标不重复创建；改变目标须走正式编辑路径。

创建任务并不批准实施。主 Agent 勘察工作区，提交 Task 的验收标准与 DAG，独立计划审查通过后等待批准。普通询问不自动建立 Task；Todo、规划 skill、原生 Goal 或 Plan 也不代表 Task 已建立。无任务时侧栏明确显示未启用督导；主 Agent 的回答保持原生输出。

## Goal、Plan 与续行

原生 Goal、Plan 和 Todo 工具继续可用。Task 保留期间，Supervisor 使用可选的公开 GoalService.disarm 解除 Goal 的进程内自动续行，保留 Goal 的目标、阶段、版本与持久历史；Goal 创建、恢复或激活时重新核对。缺少 Goal 服务不阻塞 Supervisor。Plan 不另开督导工作流。

Task 的批准和完成仍由自己的协议决定。原生 Plan 获批不能批准 Task；原生 Goal 完成不能完成 Task。暂停、审查、关闭和任务完成期间，原生 Goal 不能继续自动推进。`/task clear` 释放控制名额，但不会自动恢复 Goal；用户之后明确恢复原生 Goal 才重新取得其续行许可。只使用日志审查的 Task 不因此获得独立产物验证能力。

## 恢复与兼容

门禁附着于 Agent 作用域，不更换已经开始会话的 preset。热卸载 Supervisor 后，当前受控 Agent 的步骤和工具仍被门禁拒绝；重新加载插件后须手动恢复 Task。装有插件的冷重启重建任务并保持停用，直到显式恢复。

完全不加载插件的冷启动没有该门禁。当前公开 Host 不提供按 Session 持久要求某插件必须存在的通用准入 API；原生 preset 仍能加载，不能将此情形宣称为受督导恢复。0.1.1 的旧专用 preset Session 可显式配置 `legacyPresets: true` 恢复，此兼容选项会注册旧模式；默认不注册，不改写日志。0.1.0 私有扩展日志继续使用原 Host。

## 验证

控制器回归涵盖自然语言创建、重复调用、原始消息绑定、原生 Goal/Plan 共存、暂停和完成权限、热卸载、重启与原生配置保留。真实模型与官方安装证据见[验证记录](native-task-checks.json)；[命令入口验证](task-entry-checks.json)记录直接创建与裸命令的流程。这轮不修改 DSH 主循环、原生沙箱或用户日常 profile，不代表长程优越性评测。

[English](native-task.md)
