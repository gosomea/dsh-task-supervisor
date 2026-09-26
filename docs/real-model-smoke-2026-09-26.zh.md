# 真实模型隔离测试：2026-09-26

## 环境与模型

- 按 `dsh-plugin-isolated-test` 的新版模型选择规则，从日常 Web profile 重新读取 `llm-pi-ai.providers.deepseek-codebuddy` 的首个模型：`deepseek-v4.1-flash`。主 Agent 和旁路审查 Agent 均使用 `openai-completions`，代理地址为 `http://127.0.0.1:15721/tencent/v1`，凭据引用为 `DEEPSEEK_CODEBUDY_API_KEY`。
- 日常 Web 进程 PID 11374，使用默认 `~/.dsh`；测试使用独立 DSH source checkout、`/tmp/dsh-task-supervisor-smoke.Fhxusi` home、`supervisor-web-smoke` profile 和 31973 端口。插件通过 `plugin add link:<绝对路径>` 安装。测试任务工作区为 `/tmp/dsh-supervisor-real-tasks-9q5wp4iu`。
- 合成配置与持久化请求记录都显示上述模型。独立连通性会话收到模型回复 `READY`，证明本次测试不只检查配置文本。

## 任务结果

| 任务 | 主 Agent 实际结果 | 旁路审查与结局 |
| --- | --- | --- |
| 只读行数统计 | 核验 `task-1/items.txt` 为 `red`、`blue`、`green` 三个非空行，结果为 3；文件未改动 | 阶段审查通过，最终审查通过，任务为 `complete` |
| CSV 求和并写文件 | 对 `task-2/numbers.csv` 的 3、5、8 求和；`task-2/total.txt` 的实际字节为 `16\n` | 阶段审查通过，最终审查通过，任务为 `complete` |
| 修复代码并运行测试 | `task-3/math.mjs` 的 `a - b` 改为 `a + b`；独立运行 `node task-3/math.test.mjs` 退出码为 0 | 待审批计划从三阶段修订为单阶段后获批；阶段审查通过，最终审查通过，任务为 `complete` |

持久化数据中有 3 个任务主 Session、1 个连通性 Session、1 个空白 UI Session，以及 7 个审查 Session。其中 6 个审查 Session 发出了 `deepseek-codebuddy/deepseek-v4.1-flash` 请求并正常结束；最初 1 个在发出请求前失败，见下文。成功审查 Session 均保留了主 Session 的 `cwd` 和 `parentSession`。

## 测试中发现并修复

1. 最初的审查子 Session 缺少 `cwd`，系统提示词组装报 `{{cwd}}` 无值。改用 DSH 的 `childSessionMeta` 继承工作目录等上下文；审查失败时结束当前主轮，防止主模型在暂停态重复提交。修复后，第一个任务从暂停态手动恢复，随后完成阶段和最终审查。
2. 首次计划进入 `awaiting-approval` 后无法修订。第三个任务的主模型最初提交了三阶段计划，与“一个阶段”的指令不符；人工纠正时，`task_submit_plan` 返回状态错误。现允许在等待批准期间重提完整计划，计划版本递增，批准只落在最新版。重启隔离 Host 后，主模型提交单阶段计划 v2，审批后完成任务。

## 验证范围与收尾

- 使用隔离 DSH source 的 strict typecheck、17 个 kernel 测试、构建与 `pnpm pack --dry-run --json` 均通过。打包清单只有插件声明的代码、配置、package metadata 和两份 README。
- 浏览器操作验证了新建任务、计划批准、阶段审查、最终完成以及右侧督导面板。还验证了待审批计划可以被替换。
- 测试 Host 已停止，测试浏览器标签已关闭，隔离 home 中临时复制的凭据已删除。日常 Web PID 11374 仍在运行；日常 Session 文件数从 903 增至 907，新增/更新文件位于其他工作区会话目录，不在上述测试工作区。测试产生的 Session 均位于隔离 home。日常 Session store 因并行用户活动发生变化，因此不能声称字节级不变。
- 进展审查的生产阈值、长时自动续轮、`/task off`、fork 与异常重启仍未在真实模型 Host 中逐一测试；现有 kernel 测试覆盖部分状态路径，不代替这些端到端验证。
