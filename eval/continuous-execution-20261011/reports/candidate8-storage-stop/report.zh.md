# Supervisor 已曝光题开发回归

已封口 **1/8** 个计划位置。基础设施和评分异常保留在分母中，未知奖励记为 null。

| 条件 | 封口/计划 | reward=1 | reward=0 | 未知 | 严格成功 |
|---|---:|---:|---:|---:|---:|
| supervisor-independent | 1/8 | 0 | 0 | 1 | 0 |

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
| lh-01-updo-policy-alerting-supervisor-independent-r2 | sealed | storage-limit | null | null | null | 213 | null（见已报告下界） | 2 |
| lh-02-koota-pair-relation-tracking-supervisor-independent-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-03-geo-shapeindex-serialization-supervisor-independent-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-04-geo-shapeindex-serialization-supervisor-independent-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-05-updo-policy-alerting-supervisor-independent-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-06-koota-pair-relation-tracking-supervisor-independent-r1 | not-delivered | — | — | — | — | — | — | — |
| lh-07-superjson-error-stack-serialization-supervisor-independent-r2 | not-delivered | — | — | — | — | — | — | — |
| lh-08-superjson-error-stack-serialization-supervisor-independent-r1 | not-delivered | — | — | — | — | — | — | — |

## 实际执行轨迹

| 位置 | Session 数 | 模型执行步 | 工具调用 | 工具错误 | 压缩次数 | Supervisor 节点 | 原生轮次结束原因（次数） |
|---|---:|---:|---:|---:|---:|---:|---|
| lh-01-updo-policy-alerting-supervisor-independent-r2 | 8 | 212 | 287 | 31 | 0 | 6 | completed: 14, aborted: 4 |

## 持久审查时间窗

| 位置 | 审查作业 | 作业窗口累计（秒） | 重叠窗口合并（秒） | 时间窗未知作业 |
|---|---:|---:|---:|---:|
| lh-01-updo-policy-alerting-supervisor-independent-r2 | 7 | 1842.858 | 1842.858 | 0 |

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
| lh-01-updo-policy-alerting-supervisor-independent-r2 / 302510cf-17bd-41ed-b16b-6dae2d65c242 | 600.000 | 139.327 | 139.327 | 0.000 | 0.000 | 0.020 | False / False | — |
| lh-01-updo-policy-alerting-supervisor-independent-r2 / 59495b4d-8eb1-41e2-bfd2-9787e3694ae0 | 600.000 | 118.112 | 118.112 | 0.000 | 0.000 | 0.016 | False / False | — |
| lh-01-updo-policy-alerting-supervisor-independent-r2 / ff08dadc-8b6b-4311-9b21-8c02f1b1afd3 | 600.000 | 532.890 | 420.076 | 60.009 | 52.805 | 0.026 | False / False | — |
| lh-01-updo-policy-alerting-supervisor-independent-r2 / a0be3f8f-87d6-4395-aa8b-ea568fd0eca0 | 600.000 | 285.793 | 285.793 | 0.000 | 0.000 | 0.019 | False / False | — |
| lh-01-updo-policy-alerting-supervisor-independent-r2 / 4e1f7dbf-9c01-4db4-9a01-0b4191e5368b | 600.000 | 144.984 | 144.984 | 0.000 | 0.000 | 0.102 | False / False | — |
| lh-01-updo-policy-alerting-supervisor-independent-r2 / 746e9630-7829-4a70-b90e-a5498a55a890 | 600.000 | 439.132 | 420.055 | 19.077 | 0.000 | 0.072 | False / False | — |
| lh-01-updo-policy-alerting-supervisor-independent-r2 / ce381d16-c8c3-43ab-ad5b-facc7e58b09c | 600.000 | 181.873 | 181.873 | 0.000 | 0.000 | 0.075 | False / False | — |

作业墙钟按持久 admittedAt 与 finishedAt 计算；清理另计，终态记录的排队与落盘延迟不当作新预算。旧作业缺少预算或阶段边界时为 null。
