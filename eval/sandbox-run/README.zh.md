---
description: "冻结运行环境、确定性监控和独立评分的 OpenSandbox 评测入口。"
kind: "scratch"
---

# OpenSandbox 长程评测

本目录执行[长程协议](protocol.zh.md)，使用新的 24 个位置，不改写此前 DeepSWE 或 SWE-bench 分母。外层监控由 Python 负责，Task 控制器负责续行与恢复，官方评分器独立验收补丁。

## 当前实现

[环境准入记录](admission-20261009.json)确认原生工作区权限、快照恢复、管理员检查网关、取消清理、主／审查者实际请求路由，以及四道候选题的官方空补丁／参考补丁控制。正式运行已开始；[结果快照](long-horizon-20261009/reports/)保留全部计划位置。Task 范围持久预算、确定性监控与收集评分已实现；修订开发用例完成并获外部夹具 reward=1。严格故障恢复、四题最终安装与快照接线已通过；[正式批次](long-horizon-20261009/README.zh.md)已冻结 24 个位置。首轮失败与修复均保留，见[运行框架验收](validation-20261009.zh.md)。

| 入口 | 用途 |
| --- | --- |
| `preflight` | 显式输入镜像、tarball、摘要和编译探针，验证原生读取、工作区写入及边界拒绝；不投模型 |
| `probe` | 无模型快照／恢复探测；保留快照，销毁本次源与恢复沙盒 |
| `baseline` | 在凭据与模型投递前准备公开开发夹具的干净快照 |
| `controls.py` | 原封不动运行官方空补丁和参考补丁评分，保留独立环境及清理证据 |
| `route_preflight.py` | 单独校准主 Agent 与绑定审查者的实际 HTTP 请求和持久 Session 归属 |
| `run` / `observe` | 一次投递后监控原运行；核对持久租约、动作身份、授权与绝对截止 |
| `collect` | 停止后收集日志、产物、已提交补丁与检查副本；校验后释放本次资源 |
| `grade` | 对原产物运行一次外部夹具或官方评分；响应未知时核对原评分进程 |
| `summarize` | 保留完整计划分母、缺失指标与逐题配对差异 |
| `batch.py` | 串行执行冻结 release；每位置复核摘要和容量，已启动位置只接续 |

旧 `launch`／`decide` 是整合前的实验入口，含第二个模型监督器和外层恢复规则，**不用于本协议**。当前正式路径使用一个 Python 监控器与各条件自身的原生控制器。

## 准入命令

使用 requirements 锁定的 Python 3.13 环境；本机 Python 3.14 的既有 Pydantic 安装不能加载 SDK，不能以该环境的失败判断插件行为。

```sh
python3.13 -m unittest discover -s eval/sandbox-run -p 'test_*.py' -v
python3.13 eval/sandbox-run/run.py --domain localhost:8090 preflight \
  --image FROZEN_IMAGE --tarball FROZEN_TARBALL --tarball-sha256 SHA256 \
  --probe COMPILED_NATIVE_PROBE --out NEW_PRIVATE_RECEIPT_DIRECTORY
```

`Dockerfile.runtime` 在投模型前安装固定 Node 24.21.0、pnpm 11.7.0 和公开 DSH 0.2.0-rc.2。构建者必须传入基线镜像及 Node 官方归档摘要；之后使用最终镜像摘要。`Dockerfile.gateway` 仅为管理员检查服务加入 Docker CLI，不含模型凭据。

## 隔离与连接

先按隔离测试 skill 查询登记环境。此次使用独立 Colima profile，DSH 的 `workspace-write` 保持生效。OpenSandbox 1.1.0 的 `bootstrap.execd.isolation` 启用嵌套 namespace；实际 DSH 越界写入仍被拒绝。

DSH 保持 loopback 监听和原生 token/cookie 认证。OpenSandbox 服务代理会过滤应用 cookie，因此 `RuntimeDshRpc` 在沙盒内调用公开 localhost API；监控器不接收认证 token。浏览器连接另行验证，不以裸 URL 声称已可用。

管理员网关拥有 Docker socket、私有检查副本和资源清理。执行侧仅挂载本次快照卷和只读私有 socket 通道；检查使用冻结镜像，不写源工作区，也不接触外部评分材料。当前无模型网关用例覆盖未跟踪产物、私有副本修改及同步取消；完整 Task／Session 绑定在开发流程中进一步验收。

## 结果与限制

收据使用独占创建、原子发布和目录 fsync；结果不能覆盖。SDK `connect` 不获取销毁权限，连接原运行不创建新的 Agent。沙盒续期不延长 Task 截止，也不再因打快照隐式续期。

环境准入保留模型投递前失败及其原因。路由校准只证明请求与归属，开发运行另有独立阶段及整体验收记录。浏览器已核对完整裁决正文、同作业重试和 Task 终态；最终候选题快照接线仍是投递门槛。

主环境按官方题目设置 2 CPU／8 GiB；独立检查 2 CPU／8 GiB、管理员网关 1 CPU／1 GiB 单列。每次新投递前核对至少 5 CPU／17 GiB 容量，以及 Docker 30 GiB、宿主 8 GiB 可用磁盘。主写层 20 GiB、私有检查存储 4 GiB 每 60 秒采样并触发停止；这不是硬磁盘配额，也不保证瞬时峰值不超限。检查 CPU 时间目前无法从原生记录恢复，保持 null。

结果封口后，检查源、私有副本及输出归档并核对摘要，再释放明确归属的卷。断点接续读取原 Session 和原导出；不重复提交、批准、评分或补写 Agent commit。最后轮询间隔内的完成只在停止后由持久原生记录核对，不接受模型自述。

`freeze.py` 只接受四题实际准入、最终包安装、真实双路由、开发修订／故障恢复及官方空／参考补丁通过证据，冻结 24 个位置与独立文件摘要。`Dockerfile.go-cache` 在投递前预热原始基线，检查把冻结缓存复制到私有目录，代码变化仍正常重新编译；检查网络保持关闭。运行器逐位置核对 SDK／评分依赖及 OpenSandbox 原服务身份，服务重启不会静默改换实验环境。
