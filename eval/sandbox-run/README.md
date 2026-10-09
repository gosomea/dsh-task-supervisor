# OpenSandbox long-horizon evaluation

This directory is the supervisor's separate runner. It does not join the frozen denominators in `deepswe/` or `swebench-pro-v2/`. The decision record is the [OpenSandbox evaluation note](../../.agents/notes/proposed/feature/2026-10-09-opensandbox-eval.md).

## Commands available now

| Command | What it does |
| --- | --- |
| `probe` | No model: create a sandbox, write a marker, snapshot, restore, destroy both sandboxes, keep the snapshot |
| `baseline` | Place the public `revision-and-evidence` files in `/workspace` and snapshot that tree before any model runs |
| `decide` | Emit one closed action for an observation JSON. It does not start a sandbox |
| `launch` | Restore a baseline snapshot, start the worker DSH inside it, and start a plugin-free supervising DSH on this machine |

`launch` allows egress and records that on the receipt. `probe` and `baseline` still deny it.

## Local check

```bash
python3 -m unittest discover -s eval/sandbox-run -v
```

## Against a real OpenSandbox

The service must already be listening on `OPEN_SANDBOX_DOMAIN` (default `localhost:8080`). Python 3.14 cannot import `opensandbox` 1.1.0; use 3.11 or 3.13:

```bash
python3.13 -m pip install -r eval/sandbox-run/requirements.txt
python3.13 eval/sandbox-run/run.py probe --image ubuntu:24.04 --out /tmp/sandbox-run-probe.json
python3.13 eval/sandbox-run/run.py baseline --case revision-and-evidence --image ubuntu:24.04 \
  --out /tmp/sandbox-run-baseline.json
```

An existing output path is refused. Sandbox creation denies egress by default. A failed probe or baseline does not send a model.

A trial on 2026-10-09 used Colima profile `dsh-eval-rosetta`. The server container is `opensandbox-eval-server` on port 8090, with config at `~/.opensandbox-eval/config.toml`. The VM's DNS was timing out, so `/etc/resolv.conf` inside the guest was temporarily set to `8.8.8.8` and `1.1.1.1` before the probe. Probe snapshot `19ce8380-2963-4f16-aa63-5304897b99ba`, baseline snapshot `2c2d2c46-7a6b-4177-b91e-c4712ed84b26`, receipts at `/tmp/sandbox-run-probe.json` and `/tmp/sandbox-run-baseline.json`. Both probe sandboxes were destroyed; the server container is still running. The PyPI `opensandbox-server` package was missing a generated module, so this trial used image `opensandbox/server:release-1.1.0`.

`launch` restores that baseline and connects the two DSHs. Parent flags come before the subcommand:

```bash
python3.13 eval/sandbox-run/run.py --domain localhost:8090 launch \
  --baseline /tmp/sandbox-run-baseline.json --out /tmp/sandbox-run-launch.json
```

The same trial's launch left sandbox `82857ad4-cbe5-49a1-a42d-c5b5a4861d0f` running, with egress allowed. The worker is DSH 0.2.0-rc.2 on Node v24.21.0, bound to `127.0.0.1:8787` and reached through the OpenSandbox proxy; `dsh web` refuses `--host 0.0.0.0`, and the proxy's Host is `host.docker.internal`, so the worker is started with `--trusted-host host.docker.internal`. `bwrap` is unusable in that container. The permission preset stays `workspace-write`, and the receipt records that. The model proxy returned HTTP 200. `/task new` created the case task. DSH 0.2 writes `session.v4.jsonl`; the phase read there is `planning`, and the closed policy issued no command. The supervising DSH has no supervisor plugin and uses `/tmp/sandbox-run-supervisor`. Receipt: `/tmp/sandbox-run-launch.json`. The baseline snapshot was kept. This connection does not finish the case.

`decide` does not need the service:

```bash
echo '{"phase":"awaiting-approval","planReviewPassed":true}' | python3 eval/sandbox-run/run.py decide --observation -
```
