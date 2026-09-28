# P2 公开题配对比较：执行记录

按[冻结协议](../frequency-p2-protocol.zh.md)运行四题、五条件、三次重复，计划 60 次。返工优化已合入 `main`：`b4e34689fbaeb8919e552c8b9926a66160da6e16`，合入后的 88 项内核测试、宿主与客户端严格检查及独立构建通过。61454 验证实例通过原生 `plugin add link:` 更新，旧返工记录仍可读取，`armed=false`；59909 长任务未重启。

本机缓存根目录为 `~/.cache/dsh-public-eval/frequency-p2-20260928`。每个尝试使用官方镜像的独立容器和 Home；登记到隔离测试 skill 的库存。运行时源码、依赖、构建、Node 和 runner 使用独立副本；首个模型调用前由 `freeze_frequency.py` 固定指纹。原协议文件与此前 NodeBB/Navidrome 成绩不改写。

## 环境与边界

- 原生 Goal/Plan 基线沿用此前 Linux Host 快照；三种 Supervisor 使用同一合入版本。实际文件指纹替代推测性的源码提交标记。
- 五组都固定 `deepseek-codebuddy/deepseek-v4.1-flash`。当前日常 profile 默认已是 `opencode-go/glm-5.3-flash`；P2 沿用用户批准的冻结模型，与日常配置中的首个 CodeBuddy 路由一致，不声称与当前日常默认选择相同。
- 官方评分门禁先运行空补丁与参考解。未准入题不送给模型；它们留在 60 个计划位置中，单列为未准入，不能算模型失败或擅自替换。
- 按题目和重复形成五条件配对，组内按协议 SHA-256 顺序串行。只批准规定的一次初始计划；没有追加救场、模型重跑或自动评分重试。
- 截止时抓取补丁再停止容器。独立评分保留官方测试原字节。按时完成、reward=1 且无评分异常才成功；blocked、内部故障暂停到截止与超时均保留。
- 每次保留原生日志、全部 Session Token、实际模型选择、审查作业/等待/补交与批准收据。误暂停、纠偏收益未盲审时为 null。
- 中断后有 `started.json` 而无结果的尝试要求核对实际容器与日志，不允许无声重投模型。完成的结果文件不会覆盖；batch 文件锁阻止两个控制器同时运行。

## 运行入口

准备官方任务 checkout、独立 runtime 副本和五组 profile 后，先运行门禁：

```bash
python3 eval/review-recovery/run_frequency.py controls \
  --root ~/.cache/dsh-public-eval/frequency-p2-20260928 \
  --dataset ~/.cache/dsh-public-eval/benchmark
```

在首个模型调用前冻结：

```bash
python3 eval/review-recovery/freeze_frequency.py \
  ~/.cache/dsh-public-eval/frequency-p2-20260928
```

使用冻结副本运行 `runner/eval/review-recovery/run_frequency.py attempts`，传相同 root/dataset 及隔离 skill 的 `--registry` 脚本。Plan 组需本机 `PLAYWRIGHT_ENTRY` 与 `CHROME_PATH`；它们只执行真实原生批准动作。用 `test_frequency.py` 验证排序、异常评分、未准入及重复启动保护。

执行进度与最终分母以 `controls.json`、`order.json`、`results.json` 和逐次 `attempts/*/result.json` 为准。此文不预先填写模型成绩。
