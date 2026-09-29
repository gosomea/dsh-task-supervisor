# DeepSWE 正式公开题对照评测

本报告为部分结果预览。

计划 16 项，封口 3 项，其中模型投递 1 项。

## 条件与完整分母

| 条件 | 计划 | 封口 | 有效主成功 | 已知失败 | 未知 | 成功率上下界 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| goal | 4 | 2 | 0 | 1 | 3 | 0.0%–75.0% |
| plan | 4 | 1 | 0 | 0 | 4 | 0.0%–100.0% |
| supervisor-log | 4 | 0 | 0 | 0 | 4 | 0.0%–100.0% |
| supervisor-independent | 4 | 0 | 0 | 0 | 4 | 0.0%–100.0% |

上下界仅反映未知结果，不是统计置信区间。沿用冻结汇总程序的主成功定义；缺少有效路由证据的基础设施位置保持未知，故障数量另列。

## 故障、用量与审查

终止状态计数：{"infrastructure-fault": 2, "native-stopped": 1}。

已启动官方评分流程 1 项，其中评分故障 0 项；评分未启动而存在故障记录 2 项。

完整全部 Session Token：null；缺少完整用量的位置 13 项。

已回报 Token 下界：{"uncachedInputTokens": 45417, "outputTokens": 41683, "cacheReadTokens": 230528, "cacheWriteTokens": 0}。

JSON 明细按位置保留 Session 数量、审查等待、补交、内部审查故障、检查次数、文件读取与观察记录数量。观察数量不代表证据正确。

额外检查 CPU 时间缺失时保留 null；未盲审标注的误暂停率、纠偏收益均为 null。初始授权计入原始人工介入指标，追加救场须另外核对。

## 逐题、逐次重复配对

| 题目 / 重复 | goal | plan | supervisor-log | supervisor-independent |
| --- | --- | --- | --- | --- |
| helm-array-merge-strategies / r1 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 |
| helm-array-merge-strategies / r2 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 |
| kea-atomic-signal-selectors / r1 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 |
| kea-atomic-signal-selectors / r2 | 失败 / reward 0 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 |

## 解释范围

两道题、两次重复属于工程接入小样本，不能据此声称 Supervisor 优于 Goal、Plan 或 Team。

首两个位置的投递前基础设施失败与后续冻结版本偏差须结合正式启动记录解释；它们不能作为 Goal 或 Plan 模型能力的证据。

第三个位置在原 Session 上由新观察者接续：原生结束原因是 `max-tokens`，已停止继续执行。启动与观察 release 哈希不同，机器明细明确标记 `controlProtocolDeviation=true`；旧等待计入原始墙钟耗时，不等于模型持续工作。官方评分奖励 0，故障为 null；已提交补丁为空，151 项测试中 139 通过、12 失败。该已投递 Session 的完整 Token 为 317,628。

机器明细保留各封口结果哈希、报告导出程序哈希和冻结汇总程序哈希。报告不包含凭据、认证 URL、私有绝对路径或原始模型输出。
