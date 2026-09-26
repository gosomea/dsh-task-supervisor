# 多阶段需求变更与证据开发题

这是一道**开发题**，用于检查 Supervisor 在真实模型执行中接受中途需求变更、修订计划、继续执行，以及完成前是否有实际的验证命令结果。它不是冻结留出集，也不用于宣称相对 Goal 或 Plan 的优势。[实际试跑与原生产品诊断](results-20260927.zh.md)记录了每次尝试和触发条件的限制。

## 固定流程

1. 每次用 `python3 eval/long-horizon-dev-v1/eval.py prepare revision-and-evidence /tmp/<run-id>` 新建独立工作区；不要把评分器复制进去。主 Agent 只获得 `initial` 输出的目标与公开文件。
2. Supervisor 组用 `/task new <initial>`；首次通过覆盖审查的计划批准一次。它要求两阶段：先实现 CLI，再运行报告和校验。原生 Goal、Plan 可用同一目标作产品诊断；两者没有 Supervisor 阶段审查事件，需另行定义可比较的修订触发点。
3. 第一阶段审查首次通过后，发送**一次** `revision` 输出的完整新目标。Supervisor 使用 `/task edit <revision>`。若某组在触发前已经完成或停止，记录“未触发”，保留失败或停止结果，不补发临时提示。
4. 不再给提示，直到完整完成、必须用户决策、十二个主模型轮次或十五分钟上限。所有组使用相同模型路由与隔离 Host，记录审批、审查、用户动作和停止原因。
5. 用 `python3 eval/long-horizon-dev-v1/eval.py check revision-and-evidence /tmp/<run-id> /absolute/path/to/main/session.v4.jsonl.zstd` 验收 Supervisor 组。评分器检查最终 JSON、公开文件不变、持久目标版本与新计划，以及最终生成报告之后的独立成功验证工具调用。

原生产品诊断可用 `check_native.py initial|revised <workspace> <main-session-log>` 检查产物和调用顺序；`revised` 还拒绝在初始完成之后才到达的修订。它不提供与 Supervisor 阶段触发等价的条件，不能直接用于组间胜率比较。

阶段触发与评分有意分离：插件自己报告的 `pass` 只能决定何时发送脚本化变更，不能代替外部评分。`verify.mjs` 检查 count 和 sum，也会在存在 max 字段时检查 max；外部评分器额外要求**恰好**是修订后的三个字段，并要求 Session 有执行验证的证据。

## 重复与报告

在修改提示、插件或评分规则后，固定其 commit 和 `dataset.json`/`eval.py` 哈希，再对每组同一题至少运行三个新工作区。保留所有运行，包括未触发变更、基础设施错误、审查暂停和超时；报告通过数与总数、每次 Session ID、主轮次、审查调用、用户动作、首次偏离事件、最终外部评分。对单题的多次重复只说明该题稳定性，不能当成多个独立任务。正式比较另加其他题型、留出集与 Team/续行消融组，遵循[评测设计](../../docs/evaluation.zh.md)。
