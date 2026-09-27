# 冻结样本 NodeBB 第一次配对运行

**状态：Goal 已完成，Plan 达到时间上限，Supervisor 运行中。** 这道题来自预先固定的 [六题样本](sample-v1.json)，与用于调试接入的 [NodeBB 校准题](calibration-nodebb-20260928.zh.md)不同。待运行的组不填 0 分。

## 题目与门禁

- 数据集提交：`66f92766bba642462d4bbe5479e83f91f9211862`。
- 题目：`instance_NodeBB__NodeBB-0f788b8eaa4bba3c142d171fd941d015c53b65fc-v0ec6d6c2baf3cb4797482ce4829bc25cd5716649`；公开指令 SHA-256 `15add40176459e689747122a16f0e92665aec1e0366647db900e9317609006b1`。
- 官方镜像 digest：`sha256:f4c4cd26b64f893ddeb6bda15ded32bf2aab8993775f33a20b395ada2251bcdf`；VZ/Rosetta Harbor 控制组为空补丁 `0`、参考解 `1`，均无异常。原始 job：`nodebb-frozen-nop-rosetta`、`nodebb-frozen-oracle-rosetta`。
- 每组从该镜像的新容器、空 Session、干净 `/app` 工作树启动；1 CPU、4 GiB、3000 秒上限，网络只通模型代理。三组公开指令的容器内校验值一致。模型、权限和审批口径遵照[统一协议](../../docs/evaluation.zh.md)。

## 运行状态

完成组的耗时从任务投递到主 Session 最后一条 `turn/end` 事件；超时组按 3000 秒硬上限。Token 统计包含审查／节点子 Session；未运行或未外部评分的组以“待定”表示。外部 reward 检查代码补丁，不代替任务是否按时完成的主指标。

| 工作流 | 终止原因 | 主指标 | 外部 reward | 耗时（秒） | 主 Session 步数 | 未缓存输入 Token | 输出 Token | 缓存读取 Token | 预设批准 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Goal | 完成 | 通过 | 1.0 | 1,540 | 40 | 44,159 | 33,708 | 1,196,288 | 0 |
| Plan | 时间上限 | 失败 | 1.0* | 3,000 | 71 | 143,125 | 255,170 | 3,608,448 | 1 |
| Supervisor | 运行中 | 待定 | 待定 | 待定 | 待定 | 待定 | 待定 | 待定 | 待定 |

Goal 原生状态为 `complete`，补丁 SHA-256 为 `21b21be618657f3c993c7b930d0c61b7d4659c0b255adb82fa1a0a18b47fbff3`（3,401 字节，2 个路径）。主 Agent 曾运行一条持续很久的全量 API 测试；最终是否满足题目，以独立 Harbor job `frozen-nodebb-goal-r1-grade` 的 reward `1.0`、异常数 `0` 为准。

原始运行状态、Session 日志和补丁保存在 `~/.cache/dsh-public-eval/linux-homes/frozen-nodebb-goal-r2/`。名字中的 `r2` 是因为第一次容器 Host 启动失败后保留了其诊断记录；真正的首次模型尝试编号仍为 `r1`。评分 job 在 `~/.cache/dsh-public-eval/harbor-jobs/frozen-nodebb-goal-r1-grade/`。这个结果属于本项目的 DSH 适配研究评测，不是官方榜单提交。

Plan 的原生计划由 Web 审批卡批准一次。它实施并修改了代码与项目测试，但把 `npx mocha test/api.js` 放在后台后持续等待；到 3000 秒时尚无最终回答。监控器先提取截止补丁再停止容器，补丁 SHA-256 为 `37840e78034524e0881b07533478c2ec60589b465dca862a5404de39daf3e316`（8,587 字节）。表中的 `1.0*` 是把**截止时补丁**送入独立 Harbor job `frozen-nodebb-plan-r1-timeout-diagnostic` 得到的诊断 reward，异常数为 0；它说明代码可通过测试，**不改变**按时完成主指标的失败判定。Plan 没有宣称最终完成，因此这不是错误完成案例，而是未及时结束。原始状态、补丁和 Session 日志在 `~/.cache/dsh-public-eval/linux-homes/frozen-nodebb-plan-r1/`。

在三组都完成、逐题环境门禁与记录齐备之前，不计算三组胜率，也不对 Supervisor 与 Goal／Plan 的相对能力下结论。
