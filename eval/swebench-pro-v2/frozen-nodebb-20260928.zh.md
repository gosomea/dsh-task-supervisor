# 冻结样本 NodeBB 第一次配对运行

**状态：首题三组运行中。** 这道题来自预先固定的 [六题样本](sample-v1.json)，与用于调试接入的 [NodeBB 校准题](calibration-nodebb-20260928.zh.md)不同。这里只记录已完成的组；待运行的组不填 0 分。

## 题目与门禁

- 数据集提交：`66f92766bba642462d4bbe5479e83f91f9211862`。
- 题目：`instance_NodeBB__NodeBB-0f788b8eaa4bba3c142d171fd941d015c53b65fc-v0ec6d6c2baf3cb4797482ce4829bc25cd5716649`；公开指令 SHA-256 `15add40176459e689747122a16f0e92665aec1e0366647db900e9317609006b1`。
- 官方镜像 digest：`sha256:f4c4cd26b64f893ddeb6bda15ded32bf2aab8993775f33a20b395ada2251bcdf`；VZ/Rosetta Harbor 控制组为空补丁 `0`、参考解 `1`，均无异常。原始 job：`nodebb-frozen-nop-rosetta`、`nodebb-frozen-oracle-rosetta`。
- 每组从该镜像的新容器、空 Session、干净 `/app` 工作树启动；1 CPU、4 GiB、3000 秒上限，网络只通模型代理。三组公开指令的容器内校验值一致。模型、权限和审批口径遵照[统一协议](../../docs/evaluation.zh.md)。

## 运行状态

耗时从任务投递到主 Session 最后一条 `turn/end` 事件。Token 统计包含审查／节点子 Session；未运行或未外部评分的组以“待定”表示。

| 工作流 | 状态 | 外部 reward | 耗时（秒） | 主 Session 步数 | 未缓存输入 Token | 输出 Token | 缓存读取 Token | 预设批准 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Goal | 已完成并外部评分 | 1.0 | 1,540 | 40 | 44,159 | 33,708 | 1,196,288 | 0 |
| Plan | 运行中 | 待定 | 待定 | 待定 | 待定 | 待定 | 待定 | 待定 |
| Supervisor | 待运行 | 待定 | 待定 | 待定 | 待定 | 待定 | 待定 | 待定 |

Goal 原生状态为 `complete`，补丁 SHA-256 为 `21b21be618657f3c993c7b930d0c61b7d4659c0b255adb82fa1a0a18b47fbff3`（3,401 字节，2 个路径）。主 Agent 曾运行一条持续很久的全量 API 测试；最终是否满足题目，以独立 Harbor job `frozen-nodebb-goal-r1-grade` 的 reward `1.0`、异常数 `0` 为准。

原始运行状态、Session 日志和补丁保存在 `~/.cache/dsh-public-eval/linux-homes/frozen-nodebb-goal-r2/`。名字中的 `r2` 是因为第一次容器 Host 启动失败后保留了其诊断记录；真正的首次模型尝试编号仍为 `r1`。评分 job 在 `~/.cache/dsh-public-eval/harbor-jobs/frozen-nodebb-goal-r1-grade/`。这个结果属于本项目的 DSH 适配研究评测，不是官方榜单提交。

在三组都完成、逐题环境门禁与记录齐备之前，不计算三组胜率，也不对 Supervisor 与 Goal／Plan 的相对能力下结论。
