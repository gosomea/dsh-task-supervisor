# P2 公开题配对比较：执行记录

按[冻结协议](../frequency-p2-protocol.zh.md)运行四题、五条件、三次重复，计划 60 次。返工优化已合入 `main`：`b4e34689fbaeb8919e552c8b9926a66160da6e16`，合入后的 88 项内核测试、宿主与客户端严格检查及独立构建通过。61454 验证实例通过原生 `plugin add link:` 更新，旧返工记录仍可读取，`armed=false`；随后核对 59909：原游戏任务已完成，97 个 Session 无运行者、armed=false；通过原生路径更新此实例，并保留原会话日志。

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

## 已启动

四题的 P0 控制均为 nop=0、oracle=1，异常=0，见 [controls.json](controls.json)。冻结队列首项是 Open Library 第一次重复的 Supervisor 稀疏审查；[启动证据](started.json)包含原生 Session、实际请求模型和独立控制器。当前完整模型成绩尚未封口，不能用启动或门禁替代任务成功。控制器独立于交互 turn 持续串行运行；每小时的当前任务 heartbeat 核对异常与最终收尾。

[59909 实例恢复证据](rework-deployment.json)保留原游戏任务的第 1 次通过与第 2 次返工；更新后仍 complete、armed=false。原生路径安装不会即时刷新原进程，此处确认所有 Session 停止后重启了该测试 LaunchAgent，并从更新后的 API 验证历史。

## 阶段结果

[首个正式结果与运行核对](progress-20260928-1506.zh.md)记录 1/60 封口时的节点审查超时、独立评分及全部 Session 用量。它是阶段快照，不是五条件最终对照结论。

[两项封口的阶段记录](progress-20260928-1606.zh.md)补充 Plan 在批准前发生输出长度截止、空补丁评分与全部 Session 用量；冻结版本继续运行。

[16:10 运行核对](progress-20260928-1610.zh.md)记录未封口 Goal 第 1 轮因 `max-tokens` 停止、原 Goal 仍 active 的现象；等待原截止评分，没有追加继续指令。

[三项封口与续行规则](progress-20260928-1629.zh.md)归档 Goal 的正式独立评分，解释冻结 driver 在 `max-tokens` 后撤销续行而保留 active 的规则，并校正原生执行截止计时。下一项 Supervisor-current 已由原控制器启动。

[19:48 六项封口核对](progress-20260928-1948.zh.md)记录首个 reward=1 但超时的截止补丁、完整分母和控制器身份。此前“每小时跟进”与“automation 启用”是历史记录；用户已关闭定时跟进，本次未恢复。原独立控制器仍执行冻结协议。
