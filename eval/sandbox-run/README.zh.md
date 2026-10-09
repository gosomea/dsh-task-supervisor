# OpenSandbox 长程测评

这个目录是 supervisor 的单独运行框架。它不并入 `deepswe/` 或 `swebench-pro-v2/` 的冻结分母。决策记录在 [OpenSandbox 评测 note](../../.agents/notes/proposed/feature/2026-10-09-opensandbox-eval.zh.md)。

## 现在能跑的

| 命令 | 作用 |
| --- | --- |
| `probe` | 无模型：创建沙盒、写标记、打快照、从快照恢复、销毁两只沙盒、保留快照 |
| `baseline` | 把 `revision-and-evidence` 的公开文件放进 `/workspace`，打成模型动手前的快照 |
| `decide` | 对一份观察 JSON 给出闭集动作，不起沙盒 |
| `launch` | 从 baseline 快照恢复沙盒，在里面启动执行 DSH，并在本机启动一个不装 supervisor 的监督 DSH |

`launch` 放行出站，并写进收据。`probe` 和 `baseline` 仍然拒绝出站。

## 本地检查

```bash
python3 -m unittest discover -s eval/sandbox-run -v
```

## 对真实 OpenSandbox

服务需已在听 `OPEN_SANDBOX_DOMAIN`（默认 `localhost:8080`）。本机 Python 3.14 导入 `opensandbox` 1.1.0 会失败，用 3.11 或 3.13：

```bash
python3.13 -m pip install -r eval/sandbox-run/requirements.txt
python3.13 eval/sandbox-run/run.py probe --image ubuntu:24.04 --out /tmp/sandbox-run-probe.json
python3.13 eval/sandbox-run/run.py baseline --case revision-and-evidence --image ubuntu:24.04 \
  --out /tmp/sandbox-run-baseline.json
```

已有输出路径会拒绝覆盖。创建沙盒时出站默认拒绝。探测或 baseline 失败就不投模型。

2026-10-09 在 Colima profile `dsh-eval-rosetta` 上试过。服务容器是 `opensandbox-eval-server`，端口 8090，配置在 `~/.opensandbox-eval/config.toml`。该虚拟机的 DNS 当时超时，探测前把客户机 `/etc/resolv.conf` 临时改成了 `8.8.8.8` 和 `1.1.1.1`。探测快照 `19ce8380-2963-4f16-aa63-5304897b99ba`，baseline 快照 `2c2d2c46-7a6b-4177-b91e-c4712ed84b26`，收据在 `/tmp/sandbox-run-probe.json` 和 `/tmp/sandbox-run-baseline.json`。两只探测沙盒已销毁，服务容器仍在跑。PyPI 上的 `opensandbox-server` 缺生成模块，这次用的是镜像 `opensandbox/server:release-1.1.0`。

`launch` 从这份 baseline 恢复沙盒，并把两只 DSH 接上。父命令的参数要写在子命令前面：

```bash
python3.13 eval/sandbox-run/run.py --domain localhost:8090 launch \
  --baseline /tmp/sandbox-run-baseline.json --out /tmp/sandbox-run-launch.json
```

同一次试跑留下的沙盒是 `82857ad4-cbe5-49a1-a42d-c5b5a4861d0f`，出站为放行。执行侧是 DSH 0.2.0-rc.2、Node v24.21.0，绑定 `127.0.0.1:8787`，经 OpenSandbox 代理访问。`dsh web` 拒绝 `--host 0.0.0.0`，代理送进来的 Host 是 `host.docker.internal`，所以执行侧带 `--trusted-host host.docker.internal`。该容器里 `bwrap` 不可用。权限预设仍是 `workspace-write`，收据记下这一点。模型代理返回 HTTP 200。`/task new` 已创建这个 case 的任务。DSH 0.2 把会话写成 `session.v4.jsonl`；从中读到的阶段是 `planning`，闭集策略没有下发命令。监督 DSH 不装 supervisor，家目录是 `/tmp/sandbox-run-supervisor`。收据在 `/tmp/sandbox-run-launch.json`。baseline 快照保留。这次连接不把 case 跑完。

`decide` 不需要服务：

```bash
echo '{"phase":"awaiting-approval","planReviewPassed":true}' | python3 eval/sandbox-run/run.py decide --observation -
```
