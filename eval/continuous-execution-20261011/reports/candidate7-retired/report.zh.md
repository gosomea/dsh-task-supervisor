# Supervisor 已曝光题开发回归

已封口 **2/8** 个计划位置。基础设施和评分异常保留在分母中，未知奖励记为 null。

| 条件 | 封口/计划 | reward=1 | reward=0 | 未知 | 严格成功 |
|---|---:|---:|---:|---:|---:|
| supervisor-independent | 2/8 | 1 | 0 | 1 | 0 |

严格成功要求截止前控制器完成、官方 reward=1 且无基础设施或评分异常。
已恢复的收集异常单列计数，保留实际官方评分和执行侧首次停止原因，不计为严格成功。

## 逐题重复

| 题目 | Supervisor |
|---|---:|
| geo-shapeindex-serialization | 未封口 |
| koota-pair-relation-tracking | 未封口 |
| superjson-error-stack-serialization | 未封口 |
| updo-policy-alerting | 未封口 |

## 解读范围

仅四道软件任务，两次重复用于同题配对。区间按题目聚类；这批结果不能证明一般长程优势。
无人工或盲审标注的误验收、误暂停和纠偏收益保持 null。宣布完成但官方失败另行机械统计。
完整机器结果包含每个计划位置、首次停止原因、奖励、评分证据、token 完整性及恢复成本。

四题已用于执行与分析，本轮仅作 Supervisor 开发回归；没有 Goal／Plan 条件，不用于未见题或条件优劣结论。

## 逐位置结果

| 位置 | 状态 | 首次停止 | 官方 reward | F2P | P2P | 请求 | 全部 token | 用户动作 |
|---|---|---|---:|---|---|---:|---|---:|
| lh-01-updo-policy-alerting-supervisor-independent-r2 | sealed | internal-review-fault | 1 | 17/17 | 123/123 | 799 | null（见已报告下界） | 2 |
| lh-02-koota-pair-relation-tracking-supervisor-independent-r2 | sealed | storage-limit | null | null | null | 232 | null（见已报告下界） | 2 |
| lh-03-geo-shapeindex-serialization-supervisor-independent-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-04-geo-shapeindex-serialization-supervisor-independent-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-05-updo-policy-alerting-supervisor-independent-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-06-koota-pair-relation-tracking-supervisor-independent-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-07-superjson-error-stack-serialization-supervisor-independent-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-08-superjson-error-stack-serialization-supervisor-independent-r1 | not-delivered | — | — | — | — | — | — | — |

## 实际执行轨迹

| 位置 | Session 数 | 模型执行步 | 工具调用 | 工具错误 | 压缩次数 | Supervisor 节点 | 原生轮次结束原因（次数） |
|---|---:|---:|---:|---:|---:|---:|---|
| lh-01-updo-policy-alerting-supervisor-independent-r2 | 15 | 798 | 1088 | 105 | 0 | 3 | completed: 34, aborted: 12 |
| lh-02-koota-pair-relation-tracking-supervisor-independent-r2 | 7 | 232 | 334 | 22 | 0 | 7 | completed: 10, aborted: 3 |

## 持久审查时间窗

| 位置 | 审查作业 | 作业窗口累计（秒） | 重叠窗口合并（秒） | 时间窗未知作业 |
|---|---:|---:|---:|---:|
| lh-01-updo-policy-alerting-supervisor-independent-r2 | 14 | 4855.861 | 4855.861 | 0 |
| lh-02-koota-pair-relation-tracking-supervisor-independent-r2 | 6 | 1387.115 | 1387.115 | 0 |

时间窗从首份持久作业记录到最终尝试的终态记录，包含排队、重试和等待；按作业去重，重叠窗口另行合并。
这些窗口不是 CPU 时间，也不能据此认定主 Agent 在整个窗口内都被阻塞；缺少边界或未结束时为 null。
报告处理器源码摘要另存，冻结运行器和原始 result.json 保持不变。
轨迹由原始收集日志只读计算，重试不是新增执行步；原生 Goal／Plan 与 Supervisor 的节点语义不作等同。
轮次结束原因来自实际 turn/end 的 data.reason.kind，含主 Session 与所属子 Session；单个轮次结束不自动代表整个控制器完成。
max-tokens 表示模型生成截断，不是根据累计 Session 用量推定整个 Task 的 token 预算耗尽。
快照仅导出计数、身份与摘要，不包含模型正文、工具参数、私有路径或凭据。
未封口位置不代表失败；当前成功数与完整分母同时保留，最终比较等待全部位置封口。
Token 总和包含独立列出的 uncached/cache-read/cache-write/output；缺失用量不补为零。
各 Session 用量、审查阶段耗时、读取失败、独立检查与资源限制见机器记录及冻结 release。

## 固定预算与阶段墙钟

| 位置 / 作业 | 总预算秒 | 作业墙钟秒 | 检查秒 | 收束秒 | 裁决秒 | 清理秒 | 超过600秒 / 超配置 | 原因 |
|---|---:|---:|---:|---:|---:|---:|---|---|
| lh-01-updo-policy-alerting-supervisor-independent-r2 / a0d2a58a-4c04-4c5a-9973-2a9ed72e7442 | 600.000 | 69.870 | 69.870 | 0.000 | 0.000 | 0.013 | False / False | — |
| lh-01-updo-policy-alerting-supervisor-independent-r2 / 9763d817-f744-48a2-89e7-d37881b85f6b | 600.000 | 82.567 | 82.567 | 0.000 | 0.000 | 0.013 | False / False | — |
| lh-01-updo-policy-alerting-supervisor-independent-r2 / f752237f-158f-4b68-bb00-a4a02cf1781e | 600.000 | 463.017 | 420.046 | 42.971 | 0.000 | 0.011 | False / False | — |
| lh-01-updo-policy-alerting-supervisor-independent-r2 / b4d40340-a119-4d7a-a76f-9392385209fe | 600.000 | 440.519 | 420.041 | 20.478 | 0.000 | 0.025 | False / False | — |
| lh-01-updo-policy-alerting-supervisor-independent-r2 / 78fe87a0-9aa2-4786-b849-6d2a1122602b | 600.000 | 167.778 | 167.778 | 0.000 | 0.000 | 0.021 | False / False | — |
| lh-01-updo-policy-alerting-supervisor-independent-r2 / 77c3691b-bb03-4b00-bdc2-884231f2552a | 600.000 | 436.224 | 420.031 | 16.193 | 0.000 | 0.019 | False / False | — |
| lh-01-updo-policy-alerting-supervisor-independent-r2 / ad6c8581-36d7-4a42-9984-6826f3ca7b1c | 600.000 | 438.902 | 420.037 | 18.865 | 0.000 | 0.022 | False / False | — |
| lh-01-updo-policy-alerting-supervisor-independent-r2 / 5fe141dc-e919-46a6-9fee-7238696b42d0 | 600.000 | 409.941 | 409.941 | 0.000 | 0.000 | 0.026 | False / False | — |
| lh-01-updo-policy-alerting-supervisor-independent-r2 / aea1c037-cff7-447f-b881-7a8b592f9dfe | 600.000 | 442.230 | 420.047 | 22.183 | 0.000 | 0.023 | False / False | — |
| lh-01-updo-policy-alerting-supervisor-independent-r2 / 5a18936e-4f83-4e26-9116-1e3698d04b02 | 600.000 | 550.862 | 420.022 | 59.986 | 70.854 | 0.032 | False / False | — |
| lh-01-updo-policy-alerting-supervisor-independent-r2 / fee6ca4b-aeb4-4049-b0ca-2723582672b8 | 600.000 | 495.707 | 420.074 | 59.965 | 15.668 | 0.023 | False / False | — |
| lh-01-updo-policy-alerting-supervisor-independent-r2 / 943b0bc5-f0d6-4330-9137-23f4c8ebdf1a | 600.000 | 392.937 | 392.937 | 0.000 | 0.000 | 0.036 | False / False | — |
| lh-01-updo-policy-alerting-supervisor-independent-r2 / 5bdafefd-6b1c-4d97-a8a3-e444668f21f2 | 600.000 | 343.407 | 343.407 | 0.000 | 0.000 | 0.032 | False / False | — |
| lh-01-updo-policy-alerting-supervisor-independent-r2 / c164f2dc-400d-43be-8f0d-517454b4058c | 120.000 | 120.098 | 84.065 | 12.320 | 23.713 | 0.059 | False / True | resource-cleanup-overlaps-budget-overrun |
| lh-02-koota-pair-relation-tracking-supervisor-independent-r2 / 0f2f96a7-cbe7-4294-b810-073eba869261 | 600.000 | 118.019 | 118.019 | 0.000 | 0.000 | 0.033 | False / False | — |
| lh-02-koota-pair-relation-tracking-supervisor-independent-r2 / 678a3f37-344a-45e3-b89f-ea15b181ec74 | 600.000 | 168.080 | 168.080 | 0.000 | 0.000 | 0.019 | False / False | — |
| lh-02-koota-pair-relation-tracking-supervisor-independent-r2 / 1e8badb8-1fb6-4dd3-aa01-66603fe9f7dc | 600.000 | 124.607 | 124.607 | 0.000 | 0.000 | 0.010 | False / False | — |
| lh-02-koota-pair-relation-tracking-supervisor-independent-r2 / 818d1a5e-959a-44c2-9b54-125c93a4223d | 600.000 | 525.545 | 420.033 | 59.990 | 45.522 | 0.016 | False / False | — |
| lh-02-koota-pair-relation-tracking-supervisor-independent-r2 / 4b71f0ac-8fd8-487a-a6f5-3ea1c3fa6b11 | 600.000 | 317.511 | 317.511 | 0.000 | 0.000 | 0.883 | False / False | — |
| lh-02-koota-pair-relation-tracking-supervisor-independent-r2 / af12f273-40e5-42db-bd6c-328983726287 | 600.000 | 130.598 | 130.598 | 0.000 | 0.000 | 0.237 | False / False | — |

作业墙钟按持久 admittedAt 与 finishedAt 计算；清理另计，终态记录的排队与落盘延迟不当作新预算。旧作业缺少预算或阶段边界时为 null。
