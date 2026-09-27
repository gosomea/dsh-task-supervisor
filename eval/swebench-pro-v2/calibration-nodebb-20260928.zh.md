# NodeBB 接入校准结果（2026-09-28）

这是一道**开发校准题**，不是冻结六题样本，也不是官方榜单提交。目标是验证 DSH 原生 Goal、原生 Plan 与 Task Supervisor 能在同一公开题上，从隔离任务镜像运行真实模型，保存完整日志，再把实际补丁交给独立 Harbor verifier。三组都通过不代表哪组更优。

## 题目与环境

- 数据集：SWE-bench Pro V2，`scaleapi/SWE-bench_Pro-os` 提交 `66f92766bba642462d4bbe5479e83f91f9211862`。
- 题目：`instance_NodeBB__NodeBB-00c70ce7b0541cfc94afe567921d7668cdc8f4ac-vnan`。官方任务镜像 digest：`sha256:59acd02e331ac2cd1fb9f3d4d72e8922b01b4e7c1dc1e9130c3cd2cf44c9786d`。
- 环境门禁：Colima VZ/Rosetta 下官方 Harbor 空补丁 reward `0`、参考解 reward `1`，两次均无异常。原 QEMU profile 的参考解因 `npm install` segmentation fault 失败，该环境不用于评分。
- DSH 源码：`bec53c60ceedd8897e6772705a2713ef0b6aba6e`；被测插件运行快照：`1217cc8c2be82ddd1b26e486ce7f84b431809605`。三组主模型均为 `deepseek-codebuddy/deepseek-v4.1-flash`，`standard` preset；Supervisor 审查 Session 的实际模型也相同。
- 每组 1 CPU、4 GiB、3000 秒上限，独立容器与 Home，Agent 工作区为官方镜像 `/app`。Agent 容器不挂载参考解或隐藏测试，出站网络只允许模型代理。DSH 权限在容器内统一为 `danger-full-access`，真实写入边界由容器实现。
- Plan 的唯一初始批准通过原生 Web 审批卡；Supervisor 的唯一初始批准通过 `/task approve`。没有补发救场提示。验收时仅用 Agent 补丁替换 staged task 的 `solution`；`instruction.md`、`task.toml`、`environment`、`tests` 与官方题目逐字节核对一致。Harbor CLI 成功后又读取 trial reward 与异常数。

## 三组结果

耗时从 `start_arm.py` 记录的投递时间到主 Session 最后一条 `turn/end` 事件，秒数取整。Token 计入可识别的所有 Session；Supervisor 包括 8 个独立审查 Session，没有委派节点 Worker。缓存命中 Token 单列，不能与输出 Token 直接相加当作费用。

| 工作流 | 外部 reward | 主 Session 轮／步 | 端到端秒 | 初始批准 | 审查 Session | 总未缓存输入 Token | 总输出 Token | 缓存读取 Token |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Goal | 1.0 | 1／61 | 459 | 0 | 0 | 40,646 | 62,467 | 1,693,568 |
| Plan | 1.0 | 1／103 | 1,291 | 1 | 0 | 147,033 | 230,399 | 5,781,888 |
| Supervisor | 1.0 | 4／122 | 2,236 | 1 | 8 | 575,893 | 314,028 | 12,504,320 |

三组均明确声明完成，外部验收均通过；本题的可观察错误完成数为 `0/3`。Supervisor 审查顺序为计划一次、两个阶段各三次（其中前两次为中途继续结论，第三次为阶段验收）、整任务完成一次，八次 verdict 均为 pass。不能把这些中途 pass 当成阶段完成，也不能把三组同题成功当成成功率或长程稳定性估计。

## 数据位置与接入偏差

原始 DSH Home、Session 日志、补丁和 `schemaVersion: 2` 的运行摘要分别在缓存根目录 `~/.cache/dsh-public-eval/linux-homes/{goal-run1,plan,supervisor}/run/`；独立评分 job 分别为 `harbor-jobs/nodebb-{goal,plan,supervisor}-calibration-grade`。原始补丁 SHA-256：Goal `744be998d7a5529eebf32b097a332b4a203c1eeb97791cdb3111981d26a6704f`；Plan `3e67e790fe46e666b3535d26873467f6be3044f5d7613d0aa8ac5f7f60baeb52`；Supervisor `801a67ffffdfdb826e717305e0f32557d2fc987994fa4d992254526dad1c7d83`。所有原始 job 和失败尝试都保留。

接入时出现三类基础设施偏差：最初 QEMU 控制组不适合 NodeBB；容器内 DSH `workspace-write` 后端不可用，工具被拒的尝试已作废；Supervisor 校准的批准器最初从 `session/list` 读取插件投影，但该列表只含核心投影，造成计划审查通过后约 95 秒的批准延迟。批准器已改为读取持久投影，在正式样本启动前修复并推送。校准的 Supervisor 耗时包含这段延迟，不用于速度结论。冻结样本的一次 Host 启动还发现任务镜像默认工作目录不同，启动脚本已修复；该 Host 未创建 Agent Session，不计模型尝试。

## 下一步

冻结六题清单见 [sample-v1.json](sample-v1.json)。其中另一道 NodeBB 题已通过空补丁 `0`、参考解 `1` 的环境门禁，并从独立干净容器开始运行三组。逐题原始结果、异常、完成声明和资源数据齐备之前，不汇总胜率；其余五题先逐题过同样环境门禁。后续才扩量、重复配对，并按[统一协议](../../docs/evaluation.zh.md)开展同一 Session 多任务评测。
