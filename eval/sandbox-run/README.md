---
description: "OpenSandbox evaluation entry point for frozen environments, deterministic monitoring and independent grading."
kind: "scratch"
---

# OpenSandbox long-horizon evaluation

This directory implements the [long-horizon protocol](protocol.md). The historical batch froze 24 positions; the current eight-position development regression is described next, with separate denominators retained. Python owns external monitoring, the Task controller owns continuation and recovery, and the official scorer independently evaluates committed patches.

## Continuous-execution development regression

The [continuous-execution Note](../../.agents/notes/proposed/architecture/2026-10-11-supervisor-continuous-execution.md) owns this change; [step validation](../continuous-execution-20261011/validation.md) records its actual gates. This batch repeats the original four exposed tasks twice: eight Supervisor-independent positions. Goal and Plan are excluded, this is not a held-out comparison, and prior batches remain unchanged.

`freeze.py` with `developmentRegression: true` requires the original exposed order, current-package cross-product validation, actual native permission and independent gateway admission for all four tasks, actual main/reviewer requests, and official scoring controls. It freezes anomaly-triggered progress reviews and the 120/300/600-second workload budgets. `formal: true` only selects official grading; separate `developmentRegression` and exposure fields prevent it from implying unseen-task results. Each position receives one initial approval, the literal original instruction, official deadline, native permissions and only Agent-committed patches; paused runs receive no rescue.

For a pre-delivery npm DNS failure, `bootstrapRegistryIpv4` can explicitly freeze an installation mapping while retaining npm HTTPS hostname and certificate checks. Native admission and route calibration share that mapping; failed receipts remain unchanged. Model-free scoring controls may be reused only after checking exact versions, dependency files and image digests and saving the identity receipt. Older-plugin native installation, snapshot and gateway admission cannot substitute for current-package checks.

Development summaries separately report actual review wall time, recorded phases, cleanup and reasons for exceeding 600 seconds or the actual budget; missing legacy fields remain null. All eight planned positions stay in the denominator, with scoring and infrastructure faults separate. Repetitions are grouped by task and do not support comparisons with conditions that were not run.

## Implementation status

The [2026-10-09 environment admission](admission-20261009.json) verifies native permissions, snapshots, the administrator gateway, cancellation cleanup, actual requests and official scoring controls. That historical batch froze 24 positions; the user subsequently stopped Goal and remaining comparisons, completing only eight Supervisor positions. [Original results](long-horizon-20261009/supervisor-final-20261010.md) and [full position snapshots](long-horizon-20261009/reports/) remain available. The continuous-execution change rechecks installation and gateway integration; old admission cannot release a new package. Earlier revision and fault recovery gates are recorded in [runner validation](validation-20261009.md).

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

After reconciled preparation, both gateway shutdown and archival resolve the ownership directory from the original preparation receipt. When main artifacts are already exported and the worker destroyed, partial collection resumes gateway archival without reconnecting or redelivering an Agent. A post-execution runner fault is recorded in `collection-reconciliation.json`, bound to the original start, preparation, terminal, export and destruction hashes; recovery adds no model requests or authorization. Actual official scoring remains available, while `collectionInfrastructureFault` is counted separately from execution faults and excludes strict success. The batch resumes delivery only after an explicit acknowledgement of the exact original result hash.

`freeze.py` accepts actual four-task admission, final-package installation, both real model routes, revision/fault development gates and official empty/reference controls before binding 24 positions and file digests. `Dockerfile.go-cache` prewarms the original baseline before delivery; checks copy the frozen cache into a private directory and altered inputs still recompile normally, with network denied. The runner checks SDK/grading dependencies and the original OpenSandbox service identity before each position; a service restart cannot silently change the experiment.
