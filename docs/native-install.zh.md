# 普通 DSH 安装与验收

## 概述

本页保留 0.1.1 发布安装验收。当前源码取消独立模式后的工作流与边界见[原生模式中的任务督导](native-task.zh.md)。

`0.1.1` 使用公开 DSH 的持久 Inbox 与 Agent preset，无需私有 Host 事件或读取器扩展。安装范围已在官方 npm `@deepseek-ai/dsh@0.2.0-rc.2`、Node 24.19.0、macOS 上验证；源码内核测试使用未经修改的 `0.1.7-alpha.2` 源码。更早版本与其他平台尚未验收。

## 安装与开始

已有官方 DSH、Web profile 和可用模型配置时运行：

```sh
dsh plugin --profile web add dsh-task-supervisor@0.1.1
dsh web
```

在新建空白会话里，第一轮模型对话前运行 `/task new <目标>`；或者先选择 `Supervisor · 标准模式` 再讨论要求。插件会保留基础 preset 配置，并生成同一模式的 Supervisor 变体。已开始的普通 Session 不能更换原生模式，请新建。督导 Session 完成后可继续创建下一项任务，历史保留。关闭督导不会更换 Session 的 preset；需要原生 Goal／Plan 时新建普通模式会话。

默认按日志审查，初始计划通过后等待 `/task approve` 或批准按钮。独立产物检查仍需按[实现状态](implementation.zh.md#独立产物检查与两阶段审查)配置 storageRoot 与实际需要的运行能力。单独的审查 Session 不代表独立运行过产物。

安装可能显示 profile 缺少 peer dependency 的警告。共享原生 SDK 由官方 DSH 的 module fallback 提供，实际 Host 加载和真实任务已通过；不要向 profile 手动安装另一版本的核心组件。修改基础 preset 配置后重启 Host，以生成新的 Supervisor 组合。

## 持久化与执行准入

控制器将带插件来源的内部记录插入原生 Inbox，并在同一同步调用中取消交付。两条原生事件保留完整 payload；状态投影只读归一化这些记录。它们不进入模型消息，不改用户回答，也不插在工具调用与结果之间。记录没有 `ignorable` 标记，原序号与时间保持不变。

Supervisor 模式只在自己的 preset 中停用原生 Goal／Plan 工作流行；普通模式保留它们。原生 preset 身份写入 Session 后，缺少插件的冷恢复拒绝加载。插件热卸载时，仍被当前 Agent 保留的作用域门禁阻止下一步和工具执行。重新安装与重启保留任务，仍须手动继续。

## 验收证据

[机器检查记录](native-install-checks.json)包含包摘要、审查身份、原生记录计数与全部已报告 Session token。原始日志、认证 URL、cookie 和凭据只保存在登记隔离环境，不进入仓库。

| 层级 | 结果 |
| --- | --- |
| 源码内核 | 23 文件、347 项通过；13 项跳过，未宣称这些检查已执行。 |
| 类型与构建 | Host／Client 严格类型检查、构建、11 文件打包检查通过。 |
| 评测读取器 | 159 项 DeepSWE 适配测试与 14 项审查汇总测试通过；旧结果未重写。 |
| 官方安装 | 通过原生 `dsh plugin --profile web add` 安装 tarball；未修改 Host／Client、原生沙箱或主循环。 |
| 真实模型 | 主 Agent 和三个审查 Session 使用 CodeBuddy `deepseek-v4.1-flash`，请求记录和实际回答均存在。 |
| 完整任务 | 读取两项数字、一次批准、节点审查与完成审查均通过，中文合计 20；input.txt 内容及唯一文件清单不变。 |
| 同会话与重启 | 下一任务暂停，重启后保持 paused／armed=false；此前完成任务与审查历史仍可读取。 |
| 缺插件保护 | 卸载后恢复原 Session 得到原生 `agent-preset/not-found`；装回后正常恢复，不产生自动执行。 |
| Web 渲染 | Client 构建与状态 API 已验收；本轮浏览器工具被客户端阻止访问，未完成渲染与按钮验收。 |

首次开发探针暴露直接插入 `user/message` 会破坏工具调用／结果配对，模型服务返回 400。该失败 Session 保留且不计为通过；改为同步 Inbox 插入／取消后，严格配对回归和干净真实任务均通过。

## 迁移边界

0.1.0 的私有 `extension/record` 日志仍须使用其原 Host；插件的旧记录折叠读取器不能扩展官方解码器。本版本不迁移或改写旧日志，请为 0.1.1 新建 Session。旧部署与正在运行的用户任务没有替换。

这轮证明普通安装、原生持久与控制流程可用，只测试一个日志模式只读任务。它没有新增独立浏览器、没有修复检查目录自动恢复，也不构成长程基准或优于 Goal／Plan 的证据。

[English](native-install.md)
