# DeepSWE 正式公开题对照评测

本报告为部分结果预览。

计划 16 项，封口 4 项，其中模型投递 2 项。

## 条件与完整分母

| 条件 | 计划 | 封口 | 有效主成功 | 已知失败 | 未知 | 成功率上下界 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| goal | 4 | 2 | 0 | 1 | 3 | 0.0%–75.0% |
| plan | 4 | 1 | 0 | 0 | 4 | 0.0%–100.0% |
| supervisor-log | 4 | 0 | 0 | 0 | 4 | 0.0%–100.0% |
| supervisor-independent | 4 | 1 | 0 | 1 | 3 | 0.0%–75.0% |

上下界仅反映未知结果，不是统计置信区间。沿用冻结汇总程序的主成功定义；缺少有效路由证据的基础设施位置保持未知，故障数量另列。

## 故障、用量与审查

终止状态计数：{"infrastructure-fault": 3, "native-stopped": 1}。

已启动官方评分流程 1 项，其中评分故障 0 项；评分未启动而存在故障记录 3 项。

完整全部 Session Token：null；缺少完整用量的位置 12 项。

已回报 Token 下界：{"uncachedInputTokens": 108855, "outputTokens": 89950, "cacheReadTokens": 1633792, "cacheWriteTokens": 0}。

JSON 明细按位置保留 Session 数量、审查等待、补交、内部审查故障、检查次数、文件读取与观察记录数量。观察数量不代表证据正确。

额外检查 CPU 时间缺失时保留 null；未盲审标注的误暂停率、纠偏收益均为 null。初始授权计入原始人工介入指标，追加救场须另外核对。

## 逐题、逐次重复配对

| 题目 / 重复 | goal | plan | supervisor-log | supervisor-independent |
| --- | --- | --- | --- | --- |
| helm-array-merge-strategies / r1 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 | 失败 / reward 未评分 |
| helm-array-merge-strategies / r2 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 |
| kea-atomic-signal-selectors / r1 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 |
| kea-atomic-signal-selectors / r2 | 失败 / reward 0 | 未知 / reward 未评分 | 未知 / reward 未评分 | 未知 / reward 未评分 |

## 解释范围

两道题、两次重复属于工程接入小样本，不能据此声称 Supervisor 优于 Goal、Plan 或 Team。

首两个位置的投递前基础设施失败与后续冻结版本偏差须结合正式启动记录解释；它们不能作为 Goal 或 Plan 模型能力的证据。

机器明细保留各封口结果哈希、报告导出程序哈希和冻结汇总程序哈希。报告不包含凭据、认证 URL、私有绝对路径或原始模型输出。

## 第四位置的 VM 故障与恢复限制

第四位置的基础设施失败来自专用 VM 的 VZ 错误，具体触发原因未知。38 次真实请求尚未产生计划或审查；不能用这次失败评价 Supervisor 审查能力。恢复没有重投模型或补充评分，原提交缺失、cleanupAcknowledged=false 和 reward=null 保留。

两份旧证据卷在恢复清理时被移除，旧私有 ledger 完整覆盖无法确认。新的全 daemon 停止证明只说明当前资源安全，可以接续下一位置；它不补造历史检查，也不将原清理失败改判为成功。详情见[资源恢复摘要](../vm-resource-recovery-20260929.json)。
