---
description: "OpenSandbox evaluation entry point for frozen environments, deterministic monitoring and independent grading."
kind: "scratch"
---

# OpenSandbox long-horizon evaluation

This directory implements the [long-horizon protocol](protocol.md) with a new denominator of 24 positions. Python owns external monitoring, the Task controller owns continuation and recovery, and the official scorer independently evaluates committed patches. Earlier DeepSWE and SWE-bench results remain unchanged.

## Implementation status

The [environment admission record](admission-20261009.json) verifies native workspace permissions, snapshot restore, the administrator check gateway, cancellation cleanup, actual main/reviewer requests, and official empty/reference controls for four candidates. Formal delivery is still **0/24**. Task-wide budgets, deterministic monitoring, collection and grading are implemented. The revision development fixture completed with external fixture reward=1. Strict fault injection and final candidate snapshot integration remain under validation; formal execution is not frozen. Initial failures and fixes remain recorded in [runner validation](validation-20261009.md).

| Entry point | Purpose |
| --- | --- |
| `preflight` | Explicit image, tarball, digest and compiled probe; verify native reads, workspace writes and boundary refusal without a model |
| `probe` | Model-free snapshot/restore; retain the snapshot and destroy the owned source/restored sandboxes |
| `baseline` | Prepare clean public development fixtures before credentials or model delivery |
| `controls.py` | Unchanged official empty/reference scoring with separate-environment and cleanup evidence |
| `route_preflight.py` | Calibrate actual main and bound-reviewer HTTP requests and durable Session lineage |
| `run` / `observe` | Monitor an original single delivery, durable ownership, actions, authorization and absolute deadline |
| `collect` | After stopping, collect logs, artifacts, committed patch and check storage; release owned resources after verification |
| `grade` | Score original artifacts once externally; reconcile the original grader on unknown response |
| `summarize` | Retain the full planned denominator, missing measures and paired task differences |
| `batch.py` | Run a frozen serial release; verify hashes/capacity per position and reconnect started positions |

Legacy `launch`/`decide` contain a second model supervisor and external rescue rules. They are **not used by this protocol**. The current path uses one Python monitor and the native controller of each condition.

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

Admission retains pre-model failures and causes. Route calibration establishes requests and lineage; development runs separately record independent stage and completion acceptance. Browser checks cover complete decision bodies, same-job retries and the Task terminal state. Final candidate snapshot integration remains a delivery gate.

Official task resources are 2 CPU/8 GiB for execution. Independent checks use 2 CPU/8 GiB and the administrator uses 1 CPU/1 GiB, reported separately. Before each new delivery, admission requires at least 5 CPU/17 GiB capacity, 30 GiB free Docker disk and 8 GiB free host disk. The main writable layer (20 GiB) and private check storage (4 GiB) are sampled every 60 seconds and trigger stopping; these are not hard disk quotas or instantaneous peak guarantees. Check CPU time cannot be recovered from current native records and remains null.

After sealing, check sources, private copies and outputs are archived and hashed before releasing explicitly owned volumes. Reconnection uses original Sessions and exports without duplicate delivery, approval, scoring or evaluator-created Agent commits. Completion in the final polling gap is verified from settled native records after stopping, never from model claims.
