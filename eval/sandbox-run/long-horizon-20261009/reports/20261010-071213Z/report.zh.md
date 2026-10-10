# 长程公开题对照结果

已封口 **11/24** 个计划位置。基础设施和评分异常保留在分母中，未知奖励记为 null。

| 条件 | 封口/计划 | reward=1 | reward=0 | 未知 | 严格成功 |
|---|---:|---:|---:|---:|---:|
| goal | 0/8 | 0 | 0 | 0 | 0 |
| plan | 5/8 | 0 | 4 | 1 | 0 |
| supervisor-independent | 6/8 | 1 | 3 | 2 | 0 |

严格成功要求截止前控制器完成、官方 reward=1 且无基础设施或评分异常。

## 逐题配对

| 题目 | Goal | Plan | Supervisor |
|---|---:|---:|---:|
| geo-shapeindex-serialization | 未封口 | 0% | 0% |
| koota-pair-relation-tracking | 未封口 | 未封口 | 0% |
| superjson-error-stack-serialization | 未封口 | 未封口 | 未封口 |
| updo-policy-alerting | 未封口 | 未封口 | 0% |

## 解读范围

仅四道软件任务，两次重复用于同题配对。区间按题目聚类；这批结果不能证明一般长程优势。
无人工或盲审标注的误验收、误暂停和纠偏收益保持 null。宣布完成但官方失败另行机械统计。
完整机器结果包含每个计划位置、首次停止原因、奖励、评分证据、token 完整性及恢复成本。

## 逐位置结果

| 位置 | 状态 | 首次停止 | 官方 reward | F2P | P2P | 请求 | 全部 token | 用户动作 |
|---|---|---|---:|---|---|---:|---|---:|
| lh-01-geo-shapeindex-serialization-plan-r2 | sealed | native-upstream-fault | null | null | null | 42 | null（见已报告下界） | 1 |
| lh-02-superjson-error-stack-serialization-plan-r1 | sealed | controller-complete | 0 | 79/80 | 116/116 | 100 | 6042696 | 2 |
| lh-03-koota-pair-relation-tracking-plan-r2 | sealed | native-stop | 0 | 0/38 | 172/172 | 71 | 5418823 | 1 |
| lh-04-geo-shapeindex-serialization-plan-r1 | sealed | native-stop | 0 | 0/24 | 599/599 | 24 | 1425578 | 1 |
| lh-05-updo-policy-alerting-plan-r1 | sealed | controller-complete | 0 | 16/17 | 123/123 | 113 | 8363528 | 2 |
| lh-06-updo-policy-alerting-supervisor-independent-r2 | sealed | infrastructure-fault | null | null | null | 7 | null（见已报告下界） | 1 |
| lh-07-koota-pair-relation-tracking-supervisor-independent-r2 | sealed | internal-review-fault | 0 | 0/38 | 172/172 | 197 | null（见已报告下界） | 2 |
| lh-08-geo-shapeindex-serialization-supervisor-independent-r2 | sealed | recovery-budget | 1 | 24/24 | 599/599 | 799 | null（见已报告下界） | 2 |
| lh-11-geo-shapeindex-serialization-supervisor-independent-r1 | sealed | deadline | 0 | 0/24 | 599/599 | 105 | null（见已报告下界） | 1 |
| lh-12-updo-policy-alerting-supervisor-independent-r1 | sealed | infrastructure-fault | null | null | null | 180 | null（见已报告下界） | 2 |
| lh-18-koota-pair-relation-tracking-supervisor-independent-r1 | sealed | internal-review-fault | 0 | 0/38 | 172/172 | 466 | null（见已报告下界） | 2 |
| lh-19-superjson-error-stack-serialization-supervisor-independent-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-23-superjson-error-stack-serialization-supervisor-independent-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-09-superjson-error-stack-serialization-goal-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-10-geo-shapeindex-serialization-goal-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-13-koota-pair-relation-tracking-goal-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-14-updo-policy-alerting-goal-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-15-updo-policy-alerting-plan-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-16-koota-pair-relation-tracking-goal-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-17-superjson-error-stack-serialization-plan-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-20-geo-shapeindex-serialization-goal-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-21-updo-policy-alerting-goal-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-22-koota-pair-relation-tracking-plan-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-24-superjson-error-stack-serialization-goal-r2 | not-delivered | — | — | — | — | — | — | — |

## 实际执行轨迹

| 位置 | Session 数 | 模型执行步 | 工具调用 | 工具错误 | 压缩次数 | Supervisor 节点 | 原生轮次结束原因（次数） |
|---|---:|---:|---:|---:|---:|---:|---|
| lh-01-geo-shapeindex-serialization-plan-r2 | 1 | 37 | 52 | 2 | 0 | 不适用／无绑定记录 | error: 1 |
| lh-02-superjson-error-stack-serialization-plan-r1 | 1 | 100 | 123 | 2 | 0 | 不适用／无绑定记录 | completed: 1 |
| lh-03-koota-pair-relation-tracking-plan-r2 | 1 | 71 | 114 | 3 | 0 | 不适用／无绑定记录 | max-tokens: 1 |
| lh-04-geo-shapeindex-serialization-plan-r1 | 1 | 24 | 43 | 2 | 0 | 不适用／无绑定记录 | max-tokens: 1 |
| lh-05-updo-policy-alerting-plan-r1 | 1 | 113 | 144 | 6 | 0 | 不适用／无绑定记录 | completed: 1 |
| lh-06-updo-policy-alerting-supervisor-independent-r2 | 1 | 7 | 14 | 2 | 0 | 不适用／无绑定记录 | aborted: 1 |
| lh-07-koota-pair-relation-tracking-supervisor-independent-r2 | 5 | 197 | 311 | 19 | 0 | 4 | completed: 7, aborted: 2 |
| lh-08-geo-shapeindex-serialization-supervisor-independent-r2 | 16 | 798 | 1162 | 99 | 0 | 4 | completed: 26, aborted: 4 |
| lh-11-geo-shapeindex-serialization-supervisor-independent-r1 | 5 | 105 | 159 | 13 | 0 | 0 | completed: 8, aborted: 1 |
| lh-12-updo-policy-alerting-supervisor-independent-r1 | 7 | 180 | 271 | 24 | 0 | 5 | completed: 10, aborted: 2 |
| lh-18-koota-pair-relation-tracking-supervisor-independent-r1 | 13 | 466 | 655 | 30 | 0 | 6 | completed: 14, aborted: 2 |

## 持久审查时间窗

| 位置 | 审查作业 | 作业窗口累计（秒） | 重叠窗口合并（秒） | 时间窗未知作业 |
|---|---:|---:|---:|---:|
| lh-01-geo-shapeindex-serialization-plan-r2 | 不适用／无绑定记录 | — | — | — |
| lh-02-superjson-error-stack-serialization-plan-r1 | 不适用／无绑定记录 | — | — | — |
| lh-03-koota-pair-relation-tracking-plan-r2 | 不适用／无绑定记录 | — | — | — |
| lh-04-geo-shapeindex-serialization-plan-r1 | 不适用／无绑定记录 | — | — | — |
| lh-05-updo-policy-alerting-plan-r1 | 不适用／无绑定记录 | — | — | — |
| lh-06-updo-policy-alerting-supervisor-independent-r2 | 不适用／无绑定记录 | — | — | — |
| lh-07-koota-pair-relation-tracking-supervisor-independent-r2 | 4 | 2466.876 | 2466.876 | 0 |
| lh-08-geo-shapeindex-serialization-supervisor-independent-r2 | 14 | 6032.742 | 6032.742 | 0 |
| lh-11-geo-shapeindex-serialization-supervisor-independent-r1 | 4 | 1695.310 | 1695.310 | 0 |
| lh-12-updo-policy-alerting-supervisor-independent-r1 | 6 | 1792.872 | 1792.872 | 0 |
| lh-18-koota-pair-relation-tracking-supervisor-independent-r1 | 12 | 3701.816 | 3701.816 | 0 |

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
