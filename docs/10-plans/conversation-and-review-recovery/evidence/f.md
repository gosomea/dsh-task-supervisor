# F：联合部署、真实模型与公开回归

**2026-09-28，A–F 已验收。** 源码门禁与真实运行分开记录。原 NodeBB/Navidrome 冻结结果保持原样；本轮公开题是一题一次的开发回归，不是新总体胜率或优越性结论。

## 源码门禁

首个不可变归档为 `f.tar.gz`，计划门禁通过并导出到[验收记录](../validation/f-20260928/report.json)。审计复核随后发现：自动补交耗尽后，手动成功会被误计为自动补交成功；现按 runtime 窗口分开统计，同时保留先前耗尽。过期而未应用的 needs-user 也不算实际暂停。

保留首个归档，最终源码另归档为 `f-final.tar.gz`，通过同一检查器；[补充记录](../validation/f-20260928/final-source.json)固定哈希和退出码，[完整输出](../validation/f-20260928/final-source.log)记录 83 项 Vitest、双端严格类型检查与隔离构建。Vitest 中的指标门禁还运行五个独立 Python 夹具。自动恢复、手动恢复、取消、旧决定和持久授权仍由原生宿主/脚本化模型夹具验证，不能把它们写成真实模型审查质量成绩。

## 浏览器发现与修复

1. 只读审查组件重复声明 DSH 原生插槽，类型检查通过但客户端加载失败。移除该声明和嵌入，改由宿主只读分页读取最近 100 条脱敏记录；不创建 reviewer Agent，也不挂载可写输入框。实测自己的完成审查返回 63 条记录，另一个 Session 请求同一 reviewer 返回 404；前后 Session 数均为 162。
2. 模型让用户说“创建任务”，控制工具却只识别长短语。补齐短语，继续要求后续明确用户消息、当前草案版本与持久来源；模糊“可以”不能创建。
3. 模型把已接受默认值留在 questions 又说“不阻塞”。提示明确所有未决问题都会阻止按钮创建，普通偏好与已接受默认值只写进要求。
4. 主模型在计划审查通过后说“无需额外决策”。执行门禁始终有效；工具现在明确返回“用户尚未批准执行”，要求模型呈现待批准状态。后续任务按此返回等待首次批准。

主 Agent 回答仍原生输出。主会话保持简略 DAG、实际参与者和动作；右侧任务详情/督导对话两个 Tab 保持原生按钮、输入和正文布局。界面证据见[完成视图](f-ui-complete.png)和[三个历史任务](f-ui-history.png)。

## 复用的隔离环境与模型

复用 registry 中 `supervisor-user`：原 `DSH_HOME=/private/tmp/dsh-task-supervisor-smoke.Fhxusi`、端口 31973、profile `supervisor-web-smoke` 与隔离 seam checkout。本次用例直接在系统 TMP 创建工作区并通过原生 API 绑定，不让用户选择文件夹，不删除已有工作区。独立构建副本安装路径保留在本机 registry；不重建其他 Host 正在服务的主仓库 lib。

[配置核对](../../../../eval/review-recovery/model-parity-evidence.json)显示隔离配置与 canonical `~/.dsh/profiles/web` 的首个 CodeBuddy 模型一致：`deepseek-codebuddy/deepseek-v4.1-flash`，OpenAI completions 路由。主、咨询及 reviewer 的实际 `request/header` 已逐一检查。另一个运行中的 RC8 官方 Host 使用独立 `.dsh-rc8` 路由，没有修改，也不声称它与本轮测试运行时等价。

裸 consultation Session 需 profile 提供原生 `/compact`；按 README 在隔离根作用域启用手动压缩，`auto:false` 不重复接管 preset 的自动观察。压缩成功以原生 `command/done` 和 `compaction/summary` 为依据。不能把普通文本或模型自述视为成功。

## 同一 Session 连续任务

主 Session：`session-55f3374b-ac71-4173-806e-4eb49683d3a5`。持续督导对话：`supervisor-chat-session-55f3374b-ac71-4173-806e-4eb49683d3a5`。机器证据见[真实集成记录](../../../../eval/review-recovery/smoke-result.json)。

| 任务 | 创建路径 | 批准路径 | 外部核对 |
| --- | --- | --- | --- |
| data.txt 非空行数 | 已展示草案按钮 | 主会话概览按钮 | 非空行 3，文件真实内容 a/b/c。 |
| Node.js 版本 | 压缩后输入“创建任务” | 督导对话输入“批准计划” | 主日志包含实际 node -v 输出与路径。 |
| data.txt SHA-256 | 显式直接建任务模式 | 主会话输入“批准” | 摘要等于外部 hashlib 结果。 |

三项均完成，共九次计划/节点/完成审查。讨论下一项时，第一项任务身份与要求不变；尚未批准不会执行。原生压缩实际影子化 36 条历史记录，之后的创建仍依赖新直接用户消息。重启后已完成任务和未创建草案保留；浏览器当时在线，不冒称完成了无客户端的冷恢复场景。fork 读取不到父草案、armed=false。第三项执行中的普通问询仅调用 `supervisor_read_log`，未调用任何控制工具。原生历史列表和独立接口都显示三项已结束任务。

工作区最终只有 `data.txt`，原始六字节 `a\nb\nc\n` 的 SHA-256 为 `880553fca8fcea94e325ee2cfb48e5a985cc797f39a14cc6d3cedecfeb2ae4d2`，与预置夹具一致。小只读任务证明入口与生命周期可用，不代表长程语义质量或所有历史 Session 场景。

## NodeBB 公开题开发回归

运行前[清单](../../../../eval/review-recovery/nodebb-regression-manifest.json)固定 E 提交 `f566a06337fe8cede8e021391c311fd7c0643c0b`、模型、默认观察规则、补交一次、3000 秒、1 CPU/4 GiB 与一次初始计划批准。与用户 Web 分开登记 `supervisor-recovery-public-r1`，在 VZ/Rosetta 的官方 amd64 镜像运行；运行期间不热改代码。F 的 UI/交互修正独立在用户验收构建测试，不能将本公开结果冒称为 F 全构建的留出成绩。

| 指标 | 结果 |
| --- | --- |
| 模型尝试分母 | 1；按时结束 1；独立通过 1。 |
| 结束 | complete，1342 秒；主会话 4 轮、51 步。 |
| 独立 Harbor | reward=1.0，异常=0；primarySuccess=true。 |
| 审查 | 计划 1、节点 2、完成 1；均有效应用。 |
| 协议故障/补交/故障暂停 | 均为 0；本次没有真实协议补交样本。 |
| 累计审查运行窗口 | 770.093 秒；仍有明显审查开销。 |
| 全部主/审查 Session Token | 非缓存输入 366686；缓存读取 4825984；输出 240230。 |
| 误暂停与纠偏收益 | 未标注，null；不能当作零。 |

[外部结果](../../../../eval/review-recovery/nodebb-regression-result.json)、[审查审计](../../../../eval/review-recovery/nodebb-recovery-audit.json)、[实际模型](../../../../eval/review-recovery/nodebb-model-evidence.json)和[评分证据](../../../../eval/review-recovery/nodebb-grading-evidence.json)保留完整关联。补丁 SHA-256 为 `56f07c38a80b7b98be047f3cafa40a8b4adc1282e57ffd3cabd2f2393f392dd4`，四个文件、13076 字节。

首次 Harbor 评分在测试前因全局 amd64 覆盖与 ARM 网络侧车冲突失败；保留原 job，作为基础设施异常。去掉全局覆盖后，以缓存的官方 amd64 题目镜像和原生侧车重验同一补丁。共两次评分尝试、一次可计分结果；没有重新跑 Agent。八个官方任务/测试/环境文件逐字节一致，仅替换 solution 为 Agent 补丁。原始 DSH 日志、补丁和两个 Harbor job 保留在本机缓存，不把空 reward 或 CLI 退出码当作通过。

## 后续边界

[频率比较协议](../../../../eval/review-recovery/frequency-p2-protocol.zh.md)冻结四道尚未投递模型的候选、五种条件、三次重复，共 60 次计划尝试；这些尝试尚未运行。默认频率不调整。本次公开回归没有进展观察，不能据此判断额外观察价值；审查缺失概率也需要更多重复。通用 clear 上下文边界尚缺宿主接口，多任务长程、Lead–Worker 对照和审查质量标注继续按统一评测路线推进。
