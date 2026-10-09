---
description: "OpenSandbox evaluation entry point for frozen environments, deterministic monitoring and independent grading."
kind: "scratch"
---

# OpenSandbox long-horizon evaluation

This directory implements the [long-horizon protocol](protocol.md) with a new denominator of 24 positions. Python owns external monitoring, the Task controller owns continuation and recovery, and the official scorer independently evaluates committed patches. Earlier DeepSWE and SWE-bench results remain unchanged.

## Implementation status

The [environment admission record](admission-20261009.json) verifies native workspace permissions, snapshot restore, the administrator check gateway, cancellation cleanup, actual main/reviewer requests, and official empty/reference controls for four candidates. Formal delivery is still **0/24**. Durable budgets, deterministic monitoring, development regressions and final freezing remain pending.

| Entry point | Purpose |
| --- | --- |
| `preflight` | Explicit image, tarball, digest and compiled probe; verify native reads, workspace writes and boundary refusal without a model |
| `probe` | Model-free snapshot/restore; retain the snapshot and destroy the owned source/restored sandboxes |
| `baseline` | Prepare clean public development fixtures before credentials or model delivery |
| `controls.py` | Unchanged official empty/reference scoring with separate-environment and cleanup evidence |
| `route_preflight.py` | Calibrate actual main and bound-reviewer HTTP requests and durable Session lineage |

Legacy `launch`/`decide` contain a second model supervisor and external rescue rules. They are **not used by this protocol** and do not establish completion of the new runner. The subsequent implementation adds `run`, `observe`, `collect`, `grade` and `summarize` to the same entry point.

## Admission commands

Use the requirements-pinned Python 3.13 environment. This workstation's existing Python 3.14/Pydantic installation cannot import the SDK; that failure is not plugin evidence.

```sh
python3.13 -m unittest discover -s eval/sandbox-run -p 'test_*.py' -v
python3.13 eval/sandbox-run/run.py --domain localhost:8090 preflight \
  --image FROZEN_IMAGE --tarball FROZEN_TARBALL --tarball-sha256 SHA256 \
  --probe COMPILED_NATIVE_PROBE --out NEW_PRIVATE_RECEIPT_DIRECTORY
```

`Dockerfile.runtime` installs fixed Node 24.21.0, pnpm 11.7.0 and public DSH 0.2.0-rc.2 before model admission. Supply the baseline image and the official Node archive digest, then freeze the resulting image digest. `Dockerfile.gateway` adds Docker CLI only to the administrator service and contains no model credentials.

## Isolation and transport

Consult the isolated-test skill registry first. This run uses a dedicated Colima profile and retains DSH `workspace-write`. OpenSandbox 1.1.0's `bootstrap.execd.isolation` enables nested namespaces; an actual native DSH external write is still refused.

DSH retains its loopback listener and native token/cookie authentication. OpenSandbox's server proxy filters application cookies, so `RuntimeDshRpc` calls the public localhost API inside the sandbox. The monitor receives no authentication token. Browser access requires separate validation.

The administrator gateway owns Docker socket access, private check copies and cleanup. The execution sandbox mounts only its snapshot volume and read-only private socket channel. Checks use a frozen image, cannot write the source workspace and cannot access external grading materials. Model-free checks cover untracked artifacts, private-copy mutation and synchronized cancellation. Complete Task/Session binding is further verified in the development flow.

## Results and limitations

Receipts use exclusive creation, atomic publication and directory fsync; results cannot be overwritten. SDK `connect` does not acquire destruction ownership or create another Agent. Sandbox renewal cannot extend Task deadlines, and snapshot creation no longer renews implicitly.

Admission retains four pre-model failures and their causes. Routing calibration deliberately stops review after observing actual main/reviewer requests; it proves routing and lineage, not a decision or independent-stage acceptance. Browser display, candidate-wide artifact integration, peak capacity and storage enforcement remain subsequent gates.
