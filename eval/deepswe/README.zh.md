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

主执行与审查者都使用当天核对的 `deepseek-codebuddy` 第一模型 `deepseek-v4.1-flash`。所有组只批准一次初始计划，不追加救场；任务截止包含批准、审查等待和续行。每次使用独立 Session 和官方任务环境。额外检查容器的资源与 CPU 时间另计，不能只报告主 Session Token 或把检查计算视为免费。

主指标要求原生控制器在截止前完成、官方独立评分为 1，且评分没有基础设施异常。报告全部 16 个位置、逐题配对结果、奖励、错误完成、截止、内部审查故障、基础设施故障、所有 Session Token、审查与命令等待、协议补交、人工介入和独立证据覆盖。没有盲审标注时，纠偏收益与误暂停率保留 `null`。

## 控制校准

先校准 [Terminal-Bench 2.1](https://github.com/harbor-framework/terminal-bench-2-1) commit `d49e28f1e4ddd13d289e85a5f312a66750951932` 的 `kv-store-grpc` 与 `db-wal-recovery`，分别覆盖后台服务和文件产物。使用现有 Harbor 0.23.0 的官方 oracle／nop，不发送模型请求。控制记录见 [机器证据](controls-20260928.json)。

`read_control.py` 针对这两道采用 CTRF 的控制题校验测试汇总与逐项结果。没有测试报告、测试明细缺失或与汇总不一致、奖励与测试汇总不一致时，奖励记为 `null`；评分脚本自己写下的原始奖励仅作诊断。它不把所有测试失败都判成基础设施故障：空操作缺少任务所要求的文件、依赖或服务，仍是有效的失败控制。DeepSWE 的独立评分接口需另行核对，不能直接假定有同样的报告文件。

两题均已取得参考解 1、空操作 0，各有 7 项测试完整执行。六次校准中四次有效评分、两次基础设施异常；这不代表 DSH 原生控制已通过。

DeepSWE 两道候选题也完成了官方独立评分校准，见[题目控制证据](task-controls-20260928.json)。Pier 0.3.1 固定 commit `0c802fc067a425345b24d1c69411aa98acf61a1d`：Helm 参考解 59/59、空解 12/59，Kea 参考解 151/151、空解 139/151；两题分别为 reward 1 和 0。四次均有覆盖全部评分位置的合并 CTRF，且没有 trial 评分异常。Helm 空解只有 23 项底层结果，另 36 项由官方合并器按“未运行或没有结果”补为失败；其官方 reward 0 保留，实际执行覆盖单独记录，不把这 36 项描述为实际运行失败。使用单独的 `colima-dsh-independent-eval` 4 CPU、20 GiB VM，主执行和评分仍按官方任务配置；旧 P2 VM 和用户实例未重启。官方控制成功不替代 DSH 接入门禁。

校准使用 `colima-dsh-eval-rosetta`，每题保持官方 1 CPU、2048 MiB 和 900 秒配置。初次其他 context 的镜像下载异常，以及数据库参考解下载评分依赖失败，都保留在分母中。无模型基础设施校准的另一次尝试使用新 job 名；旧结果不覆盖。正式模型尝试不自动重跑或替换。

## 准入与复现

当前样本 `modelAdmitted=false`、`release=null`、模型尝试 0/16。开始模型运行前，必须完成候选题空操作／参考解的独立评分、完整产物捕获、实际部署中的原生检查、后台与取消清理、主工具能力一致性，以及主／审查模型选择核对。随后冻结 runner、runtime、插件、profile、镜像、资源和顺序，并保存各项门禁证据。

`require_admission` 只校验释放记录的结构、配对矩阵及其与原始样本 SHA-256 的绑定；它不执行真实门禁，也不能用测试 fixture 的成功取代实际校准。正式 runner 及证据准入仍待接入。采样结果使用独占创建；已有开始记录却无结果时应核对原 Session、进程和截止，禁止重新投递 Agent。

`committed_patch.py` 已实现仅导出官方基线到 Agent HEAD 的二进制提交补丁；未提交、未跟踪工作只记为诊断，不由评测器补交。三项 Git fixture 回归覆盖未提交工作、已提交二进制与后续改动、非祖先提交拒绝。该导出器还未与正式 Pier 投递/评分 runner 联调。

四组真实 profile 的无模型加载、工作区绑定、主模型选择和工具 schema 对照已通过，见[profile 证据](profile-preflight-20260928.json)。Goal/Plan 的工具定义一致，两种 Supervisor 的主工具定义一致；剔除 `task_*` 控制工具后与原生组一致。`profile-probe.ts` 只在 keyless 验收 overlay 中使用，正式 profile 不加载它。这不证明真实模型请求、审查者路由、单控制器运行、批准与截止；这些门禁仍待联调。

```sh
python3 -m unittest discover -s eval/deepswe -v
```

上述命令验证采样可重复、改动版本与脏目录拒绝、配对矩阵、未准入拒绝、评分报告与异常脱敏。产物快照和检查进程的真实回归见[独立检查接入记录](../independent-verification/README.zh.md)。

## Dev Note

这一批与旧 P2 冻结批次分开。定时跟进保持关闭；现有用户 Web 实例和旧评测控制器保持各自配置。SlopCodeBench 是后续连续需求候选，官方新 Session 与本项目同 Session 扩展分别报告。
