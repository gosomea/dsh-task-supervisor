# 冻结样本 Navidrome 第一次配对运行

**状态：Goal 已完成并通过外部验收；Plan 正在运行；Supervisor 尚未投递。** 本题来自预先固定的 [六题样本](sample-v1.json)，未完成或未运行的组不填 0 分。

## 题目与门禁

- 数据集提交：`66f92766bba642462d4bbe5479e83f91f9211862`。
- 题目：`instance_navidrome__navidrome-10108c63c9b5bdf2966ffb3239bbfd89683e37b7`；公开指令 SHA-256 `30bdddea547db5c6183adb1b7badb5534929d44f75c28638aa5fc3e774a48644`。
- 官方镜像 digest：`sha256:a34b5a87a6feacf3eef6edd583c13af33bf99ce519bb4c5ade75d8b7dfb11818`。VZ/Rosetta Harbor 控制组为空补丁 `0`、参考解 `1`，均无异常；原始 job 为 `navidrome-frozen-nop-rosetta`、`navidrome-frozen-oracle-rosetta`。
- 三组使用各自的全新容器、空 Session、干净 `/app` 工作树；1 CPU、4 GiB、3000 秒上限，网络只通模型代理。公开指令的容器内哈希与冻结清单一致；模型、权限和审批口径遵照[统一协议](../../docs/evaluation.zh.md)。

## 逐组状态

| 工作流 | 终止原因 | 主指标 | 外部 reward | 耗时（秒） | 主 Session 步数 | 未缓存输入 Token | 输出 Token | 缓存读取 Token | 预设批准 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Goal | 完成 | 通过 | 1.0 | 614 | 54 | 64,225 | 41,869 | 2,176,256 | 0 |
| Plan | 运行中 | 待定 | 待定 | 待定 | 待定 | 待定 | 待定 | 待定 | 待定 |
| Supervisor | 未投递 | 待定 | 待定 | 待定 | 待定 | 待定 | 待定 | 待定 | 待定 |

Goal 原生状态为 `complete`。实际补丁 SHA-256 `9dfe5445b990db003fb9673456790b18405784774feff28491b38f262cac31eb`（15,944 字节，10 个路径），在独立 Harbor job `frozen-navidrome-goal-r1-grade` 得到 reward `1.0`、异常数 `0`。原始 Session、补丁与结果 JSON 在 `~/.cache/dsh-public-eval/linux-homes/frozen-navidrome-goal-r1/`。本题运行期间，另一题的 Supervisor 处于等待用户恢复的暂停状态；Goal 完成后的 Harbor 评分发生在 Plan 投递之前。

Plan 的原生计划批准器已启动，只会在 Web 计划审阅卡出现后批准一次。三组未全部封口前，不计算本题的配对比较。本记录属于本项目的 DSH 适配研究评测，不是官方榜单提交。
