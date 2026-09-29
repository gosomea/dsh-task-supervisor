# DeepSWE 正式公开题对照评测

本报告为部分结果预览。

计划 16 项，封口 6 项，其中模型投递 4 项。

## 条件与完整分母

| 条件 | 计划 | 封口 | 有效主成功 | 已知失败 | 未知 | 成功率上下界 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| goal | 4 | 2 | 0 | 1 | 3 | 0.0%–75.0% |
| plan | 4 | 2 | 0 | 1 | 3 | 0.0%–75.0% |
| supervisor-log | 4 | 0 | 0 | 0 | 4 | 0.0%–100.0% |
| supervisor-independent | 4 | 2 | 0 | 2 | 2 | 0.0%–50.0% |

上下界仅反映未知结果，不是统计置信区间。沿用冻结汇总程序的主成功定义；缺少有效路由证据的基础设施位置保持未知，故障数量另列。

## 故障、用量与审查

终止状态计数：{"infrastructure-fault": 3, "native-stopped": 3}。

已启动官方评分流程 3 项，其中评分故障 0 项；评分未启动而存在故障记录 3 项。

完整全部 Session Token：null；缺少完整用量的位置 10 项。

已回报 Token 下界：{"uncachedInputTokens": 201321, "outputTokens": 255689, "cacheReadTokens": 2397952, "cacheWriteTokens": 0}。

JSON 明细按位置保留 Session 数量、审查等待、补交、内部审查故障、检查次数、文件读取与观察记录数量。观察数量不代表证据正确。

额外检查 CPU 时间缺失时保留 null；未盲审标注的误暂停率、纠偏收益均为 null。初始授权计入原始人工介入指标，追加救场须另外核对。

## 逐题、逐次重复配对

| 题目 / 重复 | goal | plan | supervisor-log | supervisor-independent |
| --- | --- | --- | --- | --- |
| helm-array-merge-strategies / r1 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 | 失败 / reward 未评分 |
| helm-array-merge-strategies / r2 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 |
| kea-atomic-signal-selectors / r1 | 未知 / reward 未评分 | 失败 / reward 0 | 未知 / reward 未评分 | 失败 / reward 0 |
| kea-atomic-signal-selectors / r2 | 失败 / reward 0 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 |

## 解释范围

两道题、两次重复属于工程接入小样本，不能据此声称 Supervisor 优于 Goal、Plan 或 Team。

首两个位置的投递前基础设施失败与后续冻结版本偏差须结合正式启动记录解释；它们不能作为 Goal 或 Plan 模型能力的证据。

机器明细保留各封口结果哈希、报告导出程序哈希和冻结汇总程序哈希。报告不包含凭据、认证 URL、私有绝对路径或原始模型输出。

## 本轮接续与解释边界

第六位置 Supervisor-independent 的规划回合因 max-tokens 停止，未提交计划、未批准、未启动审查。冻结插件在 planning 阶段没有自动续行；新观察者从同一 Session 识别并封口，没有补发 prompt 或救场。官方评分只使用 Agent 已提交的补丁；实际 HEAD 等于基线、补丁为空，奖励为 0，151 项测试中 139 项通过、12 项失败。评分与清理均无基础设施异常，完整 Token 为 407,195。

原投递保持 v7，观察与评分接续使用 v8；版本偏差见[准入记录](../supervisor-planning-stop-admission-20260929.json)。原始墙钟包含模型停止后的识别、修复和冻结校验时间，模型实际停止时间保留在机器明细中。该位置没有进入独立审查，不能据此评价审查效果。

六次封口含三次基础设施故障和三次有效官方奖励 0。完整分母仍是 16；剩余位置未知，不能做条件能力排名。第四位置 VM 崩溃的触发原因仍未知，历史私有 ledger 已有缺失；其清理未确认和奖励 null 保持不变，资源退出证明仅允许继续分配。详见[资源恢复摘要](../vm-resource-recovery-20260929.json)。
