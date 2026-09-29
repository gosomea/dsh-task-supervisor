# DeepSWE 正式公开题对照评测

本报告为部分结果预览。

计划 16 项，封口 5 项，其中模型投递 3 项。

## 条件与完整分母

| 条件 | 计划 | 封口 | 有效主成功 | 已知失败 | 未知 | 成功率上下界 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| goal | 4 | 2 | 0 | 1 | 3 | 0.0%–75.0% |
| plan | 4 | 2 | 0 | 1 | 3 | 0.0%–75.0% |
| supervisor-log | 4 | 0 | 0 | 0 | 4 | 0.0%–100.0% |
| supervisor-independent | 4 | 1 | 0 | 1 | 3 | 0.0%–75.0% |

上下界仅反映未知结果，不是统计置信区间。沿用冻结汇总程序的主成功定义；缺少有效路由证据的基础设施位置保持未知，故障数量另列。

## 故障、用量与审查

终止状态计数：{"infrastructure-fault": 3, "native-stopped": 2}。

已启动官方评分流程 2 项，其中评分故障 0 项；评分未启动而存在故障记录 3 项。

完整全部 Session Token：null；缺少完整用量的位置 11 项。

已回报 Token 下界：{"uncachedInputTokens": 157863, "outputTokens": 184560, "cacheReadTokens": 2105344, "cacheWriteTokens": 0}。

JSON 明细按位置保留 Session 数量、审查等待、补交、内部审查故障、检查次数、文件读取与观察记录数量。观察数量不代表证据正确。

额外检查 CPU 时间缺失时保留 null；未盲审标注的误暂停率、纠偏收益均为 null。初始授权计入原始人工介入指标，追加救场须另外核对。

## 逐题、逐次重复配对

| 题目 / 重复 | goal | plan | supervisor-log | supervisor-independent |
| --- | --- | --- | --- | --- |
| helm-array-merge-strategies / r1 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 | 失败 / reward 未评分 |
| helm-array-merge-strategies / r2 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 |
| kea-atomic-signal-selectors / r1 | 未知 / reward 未评分 | 失败 / reward 0 | 未知 / reward 未评分 | 未知 / reward 未评分 |
| kea-atomic-signal-selectors / r2 | 失败 / reward 0 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 |

## 解释范围

两道题、两次重复属于工程接入小样本，不能据此声称 Supervisor 优于 Goal、Plan 或 Team。

首两个位置的投递前基础设施失败与后续冻结版本偏差须结合正式启动记录解释；它们不能作为 Goal 或 Plan 模型能力的证据。

机器明细保留各封口结果哈希、报告导出程序哈希和冻结汇总程序哈希。报告不包含凭据、认证 URL、私有绝对路径或原始模型输出。

## 本轮接续与基础设施边界

第五位置 Plan 的规划回合因 max-tokens 停止，没有提交批准，批准次数 0；原 Session 由新观察者识别并封口，未重投或救场。官方独立评分为 0，151 项测试中 139 项通过、12 项失败，评分和清理无基础设施异常；Agent 没有提交改动，官方评分仅使用空的已提交补丁。完整回报 Token 为 615,170。原投递运行器与新观察器的版本差异保持记录。

第五位置的原始墙钟包含停止后识别及修复耗时；模型实际停止时间见机器明细 nativeStop，不能将全部墙钟描述为模型工作时间。第六位置 Kea r1 Supervisor-independent 已投递，其奖励仍未知。

第四位置的专用 VM 崩溃触发原因仍未知；它没有提交计划或进入审查，不能用于推断审查能力。恢复清理移除了两份旧证据卷，旧私有 ledger 完整覆盖保持 false。全 daemon 停止证明仅允许下一位置分配，原 cleanupAcknowledged=false 和未评分状态不变。详见[资源恢复摘要](../vm-resource-recovery-20260929.json)和[Plan 接续准入](../plan-stop-admission-20260929.json)。
