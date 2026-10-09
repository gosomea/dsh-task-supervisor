# 2026-10-09 长程公开题对照：冻结批次

本批次使用 DeepSWE v1.1 固定提交 `0b9fabbb63b9104d678fe965e1632f2dd9eaa2ea`，四道未投递候选题：两道 Go（updo-policy-alerting、geo-shapeindex-serialization），两道 TypeScript（superjson-error-stack-serialization、koota-pair-relation-tracking）。Goal、Plan、Supervisor-independent 各重复两次，共 **24 个位置**。本记录创建时正式投递 **0/24**；开发夹具 reward 不属于这批官方结果。

## 冻结材料

- [release.json](release.json)：脱敏运行摘要、安装包与源码身份、运行依赖索引摘要、准入证据摘要。
- [order.json](order.json)：种子 `dsh-opensandbox-long-horizon-v1` 的固定顺序，第一位置为 geo / Plan / r2。
- [admission.json](admission.json)：四题原生权限、未跟踪快照、离线独立命令检查与无挂载干净 baseline；官方空补丁 0／参考补丁 1；真实主 Agent 与审查者路由证明。冻结前无模型准入失败及修复一并保留。
- [冻结安装包](artifacts/dsh-task-supervisor-frozen.tgz)：SHA-256 `cdd051964e75b930c80341b3be1fc9421996d24f23fc67d0a8ba6c36439ee366`。插件源码提交 `44b2a42`，监控及用量口径提交 `2796533`。

安装包内部版本仍为 0.1.4，是本轮明确冻结的实验包；npm 已发布的 0.1.4 不能代替它。将下载后的绝对路径代入 `dsh plugin add /absolute/path/dsh-task-supervisor-frozen.tgz`，并先核对 SHA-256。四题实际安装检查使用相同字节；本轮不发布 npm，也不更换日常 3080。

私有 release 包含完整文件索引、原始日志位置与运行配置，留在登记环境，不提交凭据、认证 URL 或评分材料。首个无模型 release 在投递前被 v2 取代，仅修正用户动作计数；原记录保留，未重新投递 Agent。

## 固定协议

使用原始题目文本、相同当天 CodeBuddy deepseek-v4.1-flash 路由及冻结推理／工具配置。每位置独立 Session、干净基线，串行执行。官方 10800 秒预算从启动计时，包含规划、批准、审查、重试及续行；评分另有官方 1800 秒上限。正式题只允许协议内一次初始批准，不注入故障、修改要求、追加提示、补提交或自动恢复暂停。

主环境 2 CPU／8 GiB，独立检查 2 CPU／8 GiB，管理员 1 CPU／1 GiB；每次新投递检查实际 5 CPU／17 GiB 容量、Docker 30 GiB 与宿主 8 GiB 余量。写层 20 GiB、私有检查存储 4 GiB 采用每 60 秒采样后停止，**不是硬配额**。Go 缓存在无模型、无网络环境预热，改动输入仍按正常缓存规则重新编译。执行侧没有 Docker socket，检查侧无评分材料与源工作区写权限。

Python 监控器是唯一外层控制器；插件负责有界恢复及调度。有启动记录就接续原位置，不重新投递；最终结果独占创建。正常产品失败继续下一位置；确定的运行器、资源或评分故障停止新投递，保留原现场与协议偏差。只有 Agent 已 commit 的 base..HEAD 补丁进入官方评分，未提交产物仅用于诊断。

## 用量与结论边界

24 个位置始终保留完整分母，未投递位置列原因。基础设施和评分故障不伪记产品 reward=0。严格成功要求截止前控制器完成、官方 reward=1 且无基础设施／评分异常。用户动作计数包含原始题目提交与显式批准，Goal 的原生创建控制记录不重复计为第二次提交；不把开发修订用例的旧计数改写为正式成绩。

全部 Session 用量缺失时总 token 为 null，并另列已报告下界；检查 CPU 时间缺少可靠记录时为 null。无人工标注的误验收、误暂停及纠偏收益保持 null；“宣布完成但官方失败”可机械核对并单列。四题的小样本配对分析以题为单位，两次重复不当成新增独立题。长时限本身不证明长程优势。

开发门槛、失败及真实恢复证据见[开发验收](../validation-20261009.zh.md)，完整流程与授权边界见[协议](../protocol.zh.md)。正式结果将在每位置收集和评分封口后追加，原结果文件不覆盖。

后续进度保存在[不可覆盖结果快照](reports/)；执行输入保持冻结。

结果导出另按原始收集的 Session 日志统计实际轮次、模型执行步、工具调用与错误、上下文压缩以及绑定 Supervisor Task 的节点。多代 Session 日志仅选取实际最高代，子 Session 按持久 parentSession 归属；无绑定或旧记录缺少 nodeRuns 时不补造节点／尝试数据。当前节点尝试编号之和包含尚未执行的节点，不能当成实际实施次数。该处理只读取已收集材料，不改写冻结输入或原结果；原生 Goal／Plan 的节点语义不与 Supervisor 强行等同。

报告同时保留实际 `turn/end` 的 `data.reason.kind` 计数，区分模型生成截断、正常结束及未知旧记录；这不是整个 Task 的终态替代。`max-tokens` 是模型响应的长度停止类型，不能将多次请求的累计用量解释为一个已耗尽的统一 Task token 上限。第三位置 Koota／Plan 首次轮次以 `max-tokens` 结束，未提交待批准计划或实现 commit，官方实际评分为空补丁 reward=0（F2P 0/38，P2P 172/172）。第四位置 Geo／Plan 同样在首次规划轮次因生成截断停止，官方空补丁 reward=0（F2P 0/24，P2P 599/599）。这些产品停止结果没有救场或重跑，之后继续固定顺序。

## 冻结后监控修复

第一位置 Plan 的原生请求重试耗尽：传输失败后连续上游 502，错误轮次已结束且没有排队续行，原监控器却未识别该状态。已停止新投递并保留原 Session。修复版单独冻结，要求两次观察确认同一请求故障事件后按基础设施故障封口，不救场、不新增授权。原 release、位置和截止继续保留；这一偏差单独报告，不算产品失败，也不重跑 Agent 替换位置。

重新校准已通过主 Agent／审查者真实 HTTP 与持久回复交叉核对。校准首次隔离安装因 DNS 解析失败，在模型投递前终止；绑定经宿主解析并实测成功的 registry.npmjs.org IPv4 后恢复。修复冻结为后续位置提供这一显式安装前映射，不改变包版本、原生权限、模型路由或题目文本。第一位置保留原 spec 与结果摘要，新控制器只可确认这一份已封口旧故障后继续；任何新基础设施／评分故障仍停止新投递。

第三版修复冻结见 [repair-v3.json](repair-v3.json)，68 项 Python 回归通过。路由校准不代表任务验收，审查在取得请求证明后停止。原 v2 和首个结果保持不可覆盖。

第二位置实施期间，受控状态回放确认另一个运行器判定缺口：已批准 Plan 的旧回复可能掩盖当前请求错误，或在原生 Inbox 仍有续行时被当成完成。新增完成依据要求当前轮次的 `turn/end.completed`、一致的轮次身份以及空 Inbox；当前已确定请求故障不能被旧完成提示覆盖，仍按两次观察确认。该修复不修改 DSH Plan、Agent 或权限。原本地监控器已停止新投递，原第二位置 Agent、Session、批准和截止保留；73 项 Python 回归通过，并实测原 Agent 在修复期间继续实施。修复版将接续原位置，不重投题目。

当前冻结见 [repair-v4.json](repair-v4.json)，运行器源码为 `bc45ef6`。24 个 spec、安装包、模型路由和运行顺序未改变，第二位置从原 Session 接续并取得有效正常完成记录后进入收集及评分。首次批准只保留原回执；此判定修复作为单独协议偏差报告，不覆盖早先 release 或结果。

后续公开快照在 `terminal.nativeCompletionEvidence` 中保留原生完成的事件编号、轮次、时间及控制器源码摘要；只导出实际持久证据，不包含事件正文。报告导出不修改冻结运行器或原始结果，控制器完成与官方评分分别展示。

## 环境交接与断点接续

执行环境使用登记的 `colima-dsh-eval-rosetta` Docker context 和 `localhost:8090` OpenSandbox 服务。原生 DSH、模型路由、镜像、运行器、安装包及评分器身份均以冻结材料为准；不要在线选择最新依赖。日常 3080 不属于本批次资源。

接手时先读取冻结 release／order、批次 owner 事件与逐位置记录，再核对实际进程完整命令行及原沙盒。锁文件或旧 PID 不能单独证明监控器仍在运行。存在活跃 owner 时只观察，不启动第二个监控器。原 owner 已结束后，使用同一私有 release 根目录与 runs 目录接续：

```sh
<SDK Python> <release>/runner/sandbox-run/batch.py <release> <runs> --python <SDK Python> --domain localhost:8090
```

`<release>` 必须是已经校验摘要的完整冻结目录；公开脱敏 `release.json` 不能代替私有执行配置。上述命令重新核对文件、服务身份及独占租约，按持久记录选择下一操作：

| 当前记录 | 下一操作 |
|---|---|
| `started.json`，无终态 | 连接原沙盒／Session，继续观察；不重新投递 Agent |
| `terminal.json`，尚未完成收集 | 停止与资源收敛后接续收集原位置 |
| `collection-complete.json`，无结果 | 使用原 Agent 已提交补丁接续独立评分 |
| `result.json` | 已封口，只读；继续固定顺序中的下一位置 |
| 只有 `delivery-intent.json`，交付结果未知 | 核对原请求与 Session；禁止创建替代位置 |

`terminal.json` 仅代表停止条件已记录；`collection-complete.json` 代表产物与日志收集完成；只有 `result.json` 才计入封口数。准入、收集、资源或评分故障需要核对原动作后处理，不能通过删除记录或追加 `resume` 推进。新修复必须另行冻结并报告协议偏差，不修改已投递 spec 或已封口结果。

结果导出使用当前已提交的 `public_results.py`，只读原始结果和收集日志，输出一个新的不可覆盖目录。报告处理版本可与冻结执行版本不同；这种差异必须记录，不能改变输入、批准或官方成绩。私有原日志、模型正文、凭据及评分材料留在原登记环境，公开包只保留脱敏计数与证据摘要。
