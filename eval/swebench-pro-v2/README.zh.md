# SWE-bench Pro V2 公开评测接入

这是[统一评测协议](../../docs/evaluation.zh.md)的 P0 接入记录。基准固定在 `scaleapi/SWE-bench_Pro-os` 提交 `66f92766bba642462d4bbe5479e83f91f9211862`。每道候选题先在官方 Harbor 环境运行 `nop` 与 `oracle`：前者必须得 0，后者必须得 1，且两次都不能有执行异常。`sanity.py` 检查 Harbor 的原始 job 和 trial 结果；未通过门禁的题不启动 Goal／Plan／Supervisor，也不计入模型成绩。

三组 NodeBB 接入校准的完整结果见 [calibration-nodebb-20260928.zh.md](calibration-nodebb-20260928.zh.md)。这道题已用于调试，三组均通过外部验收；它不计入冻结样本。

首道冻结样本的三组结果见 [frozen-nodebb-20260928.zh.md](frozen-nodebb-20260928.zh.md)：Goal 按时完成且外部通过；Plan 到时限未结束；Supervisor 的第三阶段审查未返回结构化决定，暂停到时限。后两组截止补丁虽通过外部诊断测试，主指标均为失败。第二道 [Navidrome 逐组记录](frozen-navidrome-20260928.zh.md)中，Goal 已按时完成且外部通过，Plan 正在运行。

六题 P1 集成样本已用固定种子按仓库分层抽取并冻结在 [sample-v1.json](sample-v1.json)。`select_sample.py` 保留选择算法且拒绝覆盖现有样本。NodeBB 与 Flipt 的上述两道接入校准题事先排除，避免用已看过的校准题充当保留样本。NodeBB 与 Navidrome 已过环境门禁并开始模型评分；其余样本仍须逐题过门禁。

## 本机接入记录：2026-09-28

- 隔离 DSH 源码提交：`bec53c60ceedd8897e6772705a2713ef0b6aba6e`。插件起始提交：`1217cc8c2be82ddd1b26e486ce7f84b431809605`。
- 主模型路由固定为 `deepseek-codebuddy/deepseek-v4.1-flash`；两套独立 Host 的真实请求均已返回，运行时模型选择已核对。原生 Goal／Plan 用无 Supervisor 插件的 `eval-baseline`；Supervisor 用 `supervisor-eval`。两者的隔离部署登记为 `supervisor-public-eval-baseline` 与 `supervisor-public-eval`。
- macOS arm64 上的 Colima 运行官方 `linux/amd64` 镜像。Colima 当前仅共享 `/Users/yuqixian`；Harbor 任务 checkout 与 job 目录必须放在该共享目录下，否则容器里的 `/tests` 和 `/logs` 挂载为空。首次放在 `/private/tmp` 的运行是基础设施失败，原始 job 保留，不能当作任务得分。
- 默认 QEMU Colima 中，`instance_NodeBB__NodeBB-00c70ce7b0541cfc94afe567921d7668cdc8f4ac-vnan` 的 `nop=0`、`oracle=0`。参考解验证日志显示 `npm install lodash underscore async` segmentation fault，故该**执行环境**无效。
- 另建不影响默认 Docker 的 Colima VZ/Rosetta profile `dsh-eval-rosetta`。同一 NodeBB 题在此环境的官方 Harbor 控制组为 `nop=0`、`oracle=1`，均无异常，已通过评分环境门禁。今后该题只在 VZ/Rosetta 环境评分，原 QEMU 运行保留为基础设施诊断。
- Agent 端现直接运行在官方任务镜像的 `/app` 中；DSH 源码和插件以只读挂载提供，三个工作流分别使用从同一镜像启动的独立容器、独立 Home 和相同模型。容器限制为 1 CPU、4 GiB，禁止访问公网，仅允许连接宿主的模型代理。官方 `tests`、参考解和评分 job 不挂载到 Agent 容器。容器内 DSH 的 `workspace-write` 沙箱后端不可用；初次工具被拒的尝试已作废。正式试跑统一把 DSH 权限设为 `danger-full-access`，实际写入边界由容器文件系统、只读挂载与网络规则实现。
- 接入校准题 `instance_NodeBB__NodeBB-00c70ce7b0541cfc94afe567921d7668cdc8f4ac-vnan` 的 Goal 组已结束：原生 Goal 显示 `complete`，61 步，1 轮。将 Agent 产生的补丁单独送入未修改的 Harbor verifier 后，reward 为 `1.0`、异常数为 0；原始 job 在 `nodebb-goal-calibration-grade`。这个适配重验结果证明一条真实模型链路可用，但校准题已用于调试，不进入冻结样本，也不是官方榜单提交或三组优越性结论。
- 同一校准题的 Plan 与 Supervisor 也已运行并独立重验；详情及审批器接入偏差见上方校准结果。
- 冻结样本中的另一道 NodeBB 题 `instance_NodeBB__NodeBB-0f788b8eaa4bba3c142d171fd941d015c53b65fc-v0ec6d6c2baf3cb4797482ce4829bc25cd5716649` 已在同一 VZ/Rosetta profile 过门禁：空补丁 `0`、参考解 `1`，异常数均为 0；任务镜像 digest 为 `sha256:f4c4cd26b64f893ddeb6bda15ded32bf2aab8993775f33a20b395ada2251bcdf`，公开指令的 SHA-256 与冻结清单一致。三组已封口，主指标分别为 Goal 通过、Plan 未按时结束、Supervisor 审查格式失败后暂停至截止；详见逐组报告。
- 冻结样本 Navidrome 题 `instance_navidrome__navidrome-10108c63c9b5bdf2966ffb3239bbfd89683e37b7` 也已过门禁：空补丁 `0`、参考解 `1`，均无异常；镜像 digest 为 `sha256:a34b5a87a6feacf3eef6edd583c13af33bf99ce519bb4c5ade75d8b7dfb11818`，指令 SHA-256 与冻结清单一致。三组干净容器已经备好；Goal 已完成且外部通过，Plan 正在运行。控制组运行时另一题的 Plan Agent 正在使用独立的 1 CPU 容器做全量 API 测试；该 VM 配置为 4 CPU，资源比较时仍须保留这段并行记录。
- `launch_container.py` 可从预拉取镜像和已有的干净 profile 模板，创建每次运行独立的 DSH Home、1 CPU／4 GiB 容器与仅允许模型代理的网络。初次套用在冻结 NodeBB 镜像时，镜像默认工作目录 `/app` 导致 `tsx` 未能从 `/dsh` 解析；该 Host 启动失败，没有 Agent Session。脚本已固定工作目录并用第二个全新容器验证 RPC、原始工作树和防火墙，失败记录仍保留。
- 另一个接入校准候选为 `instance_flipt-io__flipt-02e21636c58e86c51119b63e0fb5ca7b813b07b1`。它的验证脚本主要执行 Go 测试；仍需分别证明 `nop=0`、`oracle=1`，不能因语言不同预设可用。

## 复现门禁

先把任务目录放在容器可见的 checkout 下，并在 Apple Silicon 上显式拉取 `linux/amd64` 镜像；Harbor 默认拉取 arm64 时会因镜像无相应 manifest 失败。随后对同一题运行：

```bash
harbor run -p v2/tasks/<task-id> -a nop -n 1 --job-name <task-id>-nop --jobs-dir <shared-jobs-dir>
harbor run -p v2/tasks/<task-id> -a oracle -n 1 --job-name <task-id>-oracle --jobs-dir <shared-jobs-dir>
python3 sanity.py --nop <shared-jobs-dir>/<task-id>-nop --oracle <shared-jobs-dir>/<task-id>-oracle
```

Harbor CLI 的退出码不能单独表示评分成功；必须检查 trial 的异常与 reward。参考解与隐藏测试不能进入 Agent 的工作区或提示。通过门禁之后，还需确认 Agent 端的隔离、离线规则、50 分钟上限、独立干净镜像重验和三组一致的批准流程，才能把结果称为符合官方协议的成绩。若先采用 macOS 工作区与 Linux 容器评分的适配运行，必须单列为研究试跑，不能与官方成绩混用。

## Agent 端运行与留证

先用 `docker pull --platform linux/amd64` 预拉任务镜像并固定 digest。`launch_container.py` 的参数依次为工作流、唯一容器名、镜像 digest、新 Home、已配置的对应工作流模板 Home、冻结运行时缓存根目录；另传 `--host-port`，Plan 还要 `--browser-port`。模板只复制 profile 与凭据，不复制旧 Session 或工作区记录。启动后、下发题目之前，脚本给容器网络装上出站规则；需要先核对 RPC 能连通、工作树干净、镜像 digest 和指令校验值。

容器内用 `start_arm.py` 创建独立 Session 并投入公开题目。Goal、Plan、Supervisor 都使用相同的模型、`standard` preset 和权限；Plan 的原生审批由 `approve_plan.mjs` 通过真实 Web 客户端执行一次，Supervisor 的初始计划由 `approve_supervisor.py` 执行一次。`wait_arm.py` 观察原生终态并在 3000 秒时停止容器。完成后用 `extract_patch.py` 获取相对于题目基础提交的完整补丁，再用 `prepare_grade.py` 保留官方任务的 `instruction.md`、`task.toml`、`environment`、`tests` 原字节，仅用该补丁替换 `solution`，在独立 Harbor job 中重验。`collect_result.py` 保存模型使用、主 Session 统计、补丁哈希、批准收据和外部 reward；原始 DSH Home、Session 日志与 Harbor job 保存在缓存根目录。该流程是本项目的 DSH 适配研究评测，不能冒称官方榜单提交。
