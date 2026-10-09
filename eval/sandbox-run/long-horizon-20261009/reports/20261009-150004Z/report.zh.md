# 长程公开题对照结果

已封口 **1/24** 个计划位置。基础设施和评分异常保留在分母中，未知奖励记为 null。

| 条件 | 封口/计划 | reward=1 | reward=0 | 未知 | 严格成功 |
|---|---:|---:|---:|---:|---:|
| goal | 0/8 | 0 | 0 | 0 | 0 |
| plan | 1/8 | 0 | 0 | 1 | 0 |
| supervisor-independent | 0/8 | 0 | 0 | 0 | 0 |

严格成功要求截止前控制器完成、官方 reward=1 且无基础设施或评分异常。

## 逐题配对

| 题目 | Goal | Plan | Supervisor |
|---|---:|---:|---:|
| geo-shapeindex-serialization | 未封口 | 未封口 | 未封口 |
| koota-pair-relation-tracking | 未封口 | 未封口 | 未封口 |
| superjson-error-stack-serialization | 未封口 | 未封口 | 未封口 |
| updo-policy-alerting | 未封口 | 未封口 | 未封口 |

## 解读范围

仅四道软件任务，两次重复用于同题配对。区间按题目聚类；这批结果不能证明一般长程优势。
无人工或盲审标注的误验收、误暂停和纠偏收益保持 null。宣布完成但官方失败另行机械统计。
完整机器结果包含每个计划位置、首次停止原因、奖励、评分证据、token 完整性及恢复成本。

## 逐位置结果

| 位置 | 状态 | 首次停止 | 官方 reward | F2P | P2P | 请求 | 全部 token | 用户动作 |
|---|---|---|---:|---|---|---:|---|---:|
| lh-01-geo-shapeindex-serialization-plan-r2 | sealed | native-upstream-fault | None | null | null | 42 | null（见已报告下界） | 1 |
| lh-02-superjson-error-stack-serialization-plan-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-03-koota-pair-relation-tracking-plan-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-04-geo-shapeindex-serialization-plan-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-05-updo-policy-alerting-plan-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-06-updo-policy-alerting-supervisor-independent-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-07-koota-pair-relation-tracking-supervisor-independent-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-08-geo-shapeindex-serialization-supervisor-independent-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-09-superjson-error-stack-serialization-goal-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-10-geo-shapeindex-serialization-goal-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-11-geo-shapeindex-serialization-supervisor-independent-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-12-updo-policy-alerting-supervisor-independent-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-13-koota-pair-relation-tracking-goal-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-14-updo-policy-alerting-goal-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-15-updo-policy-alerting-plan-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-16-koota-pair-relation-tracking-goal-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-17-superjson-error-stack-serialization-plan-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-18-koota-pair-relation-tracking-supervisor-independent-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-19-superjson-error-stack-serialization-supervisor-independent-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-20-geo-shapeindex-serialization-goal-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-21-updo-policy-alerting-goal-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-22-koota-pair-relation-tracking-plan-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-23-superjson-error-stack-serialization-supervisor-independent-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-24-superjson-error-stack-serialization-goal-r2 | not-delivered | — | — | — | — | — | — | — |

快照仅导出计数、身份与摘要，不包含模型正文、工具参数、私有路径或凭据。
未封口位置不代表失败；当前成功数与完整分母同时保留，最终比较等待全部位置封口。
Token 总和包含独立列出的 uncached/cache-read/cache-write/output；缺失用量不补为零。
各 Session 用量、审查阶段耗时、读取失败、独立检查与资源限制见机器记录及冻结 release。
