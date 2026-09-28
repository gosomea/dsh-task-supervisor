---
description: "DeepSWE 工程接入小样本、Terminal-Bench 控制校准与正式投递门禁。"
kind: "scratch"
---

# DeepSWE 独立审查接入小样本

## 摘要

本目录固定增强独立审查的工程接入小样本：两道公开题、四组条件、两次配对重复，共 16 个计划位置。它用于验证 DSH 控制、产物提交、独立检查和外部评分能否共同运行。完整研究问题与后续连续任务路线由[评测设计](../../docs/evaluation.zh.md)维护；本样本不用于声称 Supervisor 优于 Goal、Plan 或 Team。

## 固定题单与顺序

[样本文件](sample-20260928.json)固定数据集 commit、题目元数据与指令 SHA-256、基础提交、资源、时间上限和投递顺序。`select_sample.py` 只读取元数据，按固定种子的 SHA-256 在 Go、TypeScript 中各选一道，排除已公开运行的九道 FrontierHarness 示例。样本生成时没有模型投递。

| 题目 | 语言 | 官方主执行资源 | 官方 Agent／评分截止 |
| --- | --- | --- | --- |
| `helm-array-merge-strategies` | Go | 2 CPU、8192 MiB、20480 MiB 磁盘 | 10800／1800 秒 |
| `kea-atomic-signal-selectors` | TypeScript | 2 CPU、8192 MiB、20480 MiB 磁盘 | 10800／1800 秒 |

数据集为 [DeepSWE v1.1](https://github.com/datacurve-ai/deep-swe)，固定 commit `0b9fabbb63b9104d678fe965e1632f2dd9eaa2ea`。官方使用独立评分环境，并从基础提交到 `HEAD` 提取已提交补丁。本评测不代替 Agent 自动提交未提交改动；截止时的未提交产物单列诊断。官方镜像 tag 只是候选，准入时必须固定实际 digest。

## 四组与指标

每个题目和重复编号都配对运行原生 Goal、原生 Plan、只读日志的 Supervisor，以及开启独立产物检查的 Supervisor。两种 Supervisor 使用同一进展审查频率；独立组在节点和最终审查先读取产物、执行必要检查、记录观察，再查看主 Agent 汇报。计划和进展审查保持轻量日志检查。

主执行与审查者都使用当天核对的 `deepseek-codebuddy` 第一模型 `deepseek-v4.1-flash`。每组只有一次初始授权，不追加救场。原生 Goal 的 `/goal` 命令本身构成授权，它没有独立的计划批准步骤；Plan 和 Supervisor 各批准一次初始计划，不用 Plan 包装 Goal。任务截止包含批准、审查等待和续行。每次使用独立 Session 和官方任务环境。额外检查容器的资源与 CPU 时间另计，不能只报告主 Session Token 或把检查计算视为免费。

主指标要求原生控制器在截止前完成、官方独立评分为 1，且评分没有基础设施异常。报告全部 16 个位置、逐题配对结果、奖励、错误完成、截止、内部审查故障、基础设施故障、所有 Session Token、审查与命令等待、协议补交、人工介入和独立证据覆盖。没有盲审标注时，纠偏收益与误暂停率保留 `null`。

`summarize_pilot.py` 从固定顺序与逐次封口结果汇总，未运行、未封口或无法评分的位置仍保留在完整分母中。只有成功率没有未知项时才报告单一比例，否则报告上下界。`metrics.py` 依照持久 Session 父子关系汇总主会话、审查者与 Worker，不按文件时间猜测归属。原生重试缺少上游 usage、子会话缺失或 Token 投影缺失时，完整成本为 `null`，已回报部分另列。当前原生检查记录没有容器 CPU 累计值，该项保持 `null` 并说明缺口。

## 控制校准

先校准 [Terminal-Bench 2.1](https://github.com/harbor-framework/terminal-bench-2-1) commit `d49e28f1e4ddd13d289e85a5f312a66750951932` 的 `kv-store-grpc` 与 `db-wal-recovery`，分别覆盖后台服务和文件产物。使用现有 Harbor 0.23.0 的官方 oracle／nop，不发送模型请求。控制记录见 [机器证据](controls-20260928.json)。

`read_control.py` 针对这两道采用 CTRF 的控制题校验测试汇总与逐项结果。没有测试报告、测试明细缺失或与汇总不一致、奖励与测试汇总不一致时，奖励记为 `null`；评分脚本自己写下的原始奖励仅作诊断。它不把所有测试失败都判成基础设施故障：空操作缺少任务所要求的文件、依赖或服务，仍是有效的失败控制。DeepSWE 的独立评分接口需另行核对，不能直接假定有同样的报告文件。

两题均已取得参考解 1、空操作 0，各有 7 项测试完整执行。六次校准中四次有效评分、两次基础设施异常；这不代表 DSH 原生控制已通过。

DeepSWE 两道候选题也完成了官方独立评分校准，见[题目控制证据](task-controls-20260928.json)。Pier 0.3.1 固定 commit `0c802fc067a425345b24d1c69411aa98acf61a1d`：Helm 参考解 59/59、空解 12/59，Kea 参考解 151/151、空解 139/151；两题分别为 reward 1 和 0。四次均有覆盖全部评分位置的合并 CTRF，且没有 trial 评分异常。Helm 空解只有 23 项底层结果，另 36 项由官方合并器按“未运行或没有结果”补为失败；其官方 reward 0 保留，实际执行覆盖单独记录，不把这 36 项描述为实际运行失败。使用单独的 `colima-dsh-independent-eval` 4 CPU、20 GiB VM，主执行和评分仍按官方任务配置；旧 P2 VM 和用户实例未重启。官方控制成功不替代 DSH 接入门禁。

校准使用 `colima-dsh-eval-rosetta`，每题保持官方 1 CPU、2048 MiB 和 900 秒配置。初次其他 context 的镜像下载异常，以及数据库参考解下载评分依赖失败，都保留在分母中。无模型基础设施校准的另一次尝试使用新 job 名；旧结果不覆盖。正式模型尝试不自动重跑或替换。

## 准入与复现

当前样本 `modelAdmitted=false`、`release=null`、模型尝试 0/16。[准入汇总](admission-status-20260928-2.json)连接三个门禁及父代理逐项核对的原始证据哈希，区分真实非候选题校准与正式位置。开始模型运行前，必须完成候选题空操作／参考解的独立评分、完整产物捕获、实际部署中的原生检查、后台与取消清理、主工具能力一致性，以及主／审查模型选择核对。随后冻结 runner、runtime、插件、profile、镜像、资源和顺序，并保存各项门禁证据。

`require_admission` 只校验释放记录的结构、配对矩阵及其与原始样本 SHA-256 的绑定；它不执行真实门禁，也不能用测试 fixture 的成功取代实际校准。`freeze_release.require_frozen_release` 进一步重算实际加载文件、门禁及私有证据哈希，拒绝缺项、修改与执行路径偏离。该代码已经接入，真实准入尚未完成。采样结果使用独占创建；已有开始记录却无结果时应核对原 Session、进程和截止，禁止重新投递 Agent。

`committed_patch.py` 仅导出官方基线到 Agent HEAD 的二进制提交补丁；未提交、未跟踪工作只记为诊断，不由评测器补交。`prepare_grade.py` 在独立的补丁承载环境应用该补丁并提交索引，使官方 `base..HEAD` 收集器能读取它；官方评分文件保持原字节。`grade.py` 只启动一次官方评分，核对承载与评分容器不同、已清理，以及逐项结果与奖励一致。真实 Kea 联调已取得预期 reward 0、139/151 通过，未提交与未跟踪文件被排除，见[评分接入证据](grading-gate-20260928.json)。这次无模型校准不是候选题 Agent 尝试。

`freeze_release.py` 生成尚未准入的运行版本候选：绑定可执行文件、加载目录、符号链接目标、profile、固定顺序与真实门禁证据的字节和模式；凭据必须显式排除。缺少真实路由或控制流程证据时，不能进入正式投递。最终准入仍需复核全部既有校准与新门禁；三个新门禁不能代替前述快照、后台取消和工具能力检查。

真实请求观察已接入评测专用 Cordis overlay，准入校准及正式四组都使用同一冻结观察器，见[路由说明](model-route/README.zh.md)与[首条真实链记录](model-route-gate-20260928-1.json)。本轮非候选题校准观察到主 Agent 10 次、真实审查者 9 次 HTTP 请求，均匹配当天 CodeBuddy 路由；分别有 4、3 次正常工具调用生成。上游 502／504 与流中断使计划审查没有提交有效决策，任务暂停至截止，批准次数 0、救场次数 0。独立检查组与节点、完成审查尚未证明，完整门禁保持失败。路由匹配与任务成功分别记录，运行故障不会伪装成路由偏差。

该校准已回报 Token 合计 55,754，另 12 次失败请求没有可确认的上游用量。DSH 为这些失败生成的全零 usage 不是提供方计费确认；`metrics.py` 保留已回报下界，完整成本为 `null`。正式结果缺少路由证据或发生路由偏差时，仍保留在 16 个位置中，并单列无法判定项，不能计为有效成功。

较早四组 profile 的无模型加载、工作区绑定、主模型选择和工具对照见[首次 profile 证据](profile-preflight-20260928.json)。其后通过公开 profile 组合关闭其他续行控制器，并在真实 Session 中重验，见[控制流程记录](control-flow-gate-20260928.json)：Goal／Plan／两种 Supervisor 分别提供 25／23／31／31 个工具；剔除各自控制工具后基础 schema 一致。该步骤仅验收加载与控制器能力隔离，尚不证明真实任务完成。

同一控制流程记录还保留三个新的真实 Linux 截止测试：截止后 TERM handler 的晚提交被排除、HEAD 捕获失败仍停止任务进程、脱离进程组的后台 writer 停止写入。新测试容器均已清理。旧真实模型案例的清理 ack 缺失与失败终态保持原样，后补 reconciliation 只证明其指定容器已停止。一次初始批准、真实 Goal／Plan 完成、两种 Supervisor 的完整审查链，以及独立检查容器的截止清理仍未通过，完整控制门禁为 `false`。

新用例 `control-supervisor-log-5` 已在上游恢复后跑通日志审查链，见[本次控制校准](control-calibration-20260928-2.json)、[实际路由记录 2](model-route-gate-20260928-2.json)与[最新准入汇总](admission-status-20260928-2.json)。主 Agent 24 次、计划审查 6 次、节点审查 9 次、完成审查 11 次，共 50 次请求全部返回 200 并正常完成生成，三个审查决策均已持久生效。原生任务 203.228 秒完成，初始批准 1 次、救场 0 次，截止 HEAD 与导出补丁一致，容器清理已确认。独立目录执行原 fixture 测试通过；这不是官方候选题奖励，也不是审查者自行运行产物的证据。四个 Session 完整回报 702,811 Token，其中 uncached input 108,932、output 25,431、cache read 568,448。此前失败保持原样，整体历史成本仍有未知项。另一次直接健康请求返回 200／OK，耗时 1.725 秒、79 Token，见[健康记录](upstream-health-20260928-1.json)。正式投递仍为 0/16；待验收原生 Goal／Plan、独立检查组及其任务截止清理，再冻结正式运行版本。

`run_pilot.py` 连接原生投递、控制观察、截止产物、官方评分、路由后验与封口；`--batch` 依照冻结顺序串行处理 16 个位置。开始或批准的结果不确定时，不重发；评分已经开始但结果未落盘时，等待同一评分进程的证据，不能重新启动评分。`metrics.py --review-audit` 可显式读取被冻结的统计脚本；正式 runner 从 release 的 `reviewAudit` 输入导入它。

官方资源约定同时绑定 CPU、内存与 `storageMiB=20480` 元数据。固定 Pier Docker 后端的 `resource_capabilities` 与 Compose writer 仅落实 CPU／内存，磁盘字段没有 Docker 硬配额实现；本评测明确记录 `storageEnforcement=official-docker-metadata-only`，与官方 Docker 行为一致。浏览器、Node、评分器安装树、审查统计脚本和网络辅助镜像也需按实际执行路径纳入冻结，不能只哈希声明路径。

```sh
python3 -m unittest discover -s eval/deepswe -v
```

上述命令验证采样可重复、改动版本与脏目录拒绝、配对矩阵、未准入拒绝、评分报告与异常脱敏。产物快照和检查进程的真实回归见[独立检查接入记录](../independent-verification/README.zh.md)。

## Dev Note

这一批与旧 P2 冻结批次分开。定时跟进保持关闭；现有用户 Web 实例和旧评测控制器保持各自配置。SlopCodeBench 是后续连续需求候选，官方新 Session 与本项目同 Session 扩展分别报告。
