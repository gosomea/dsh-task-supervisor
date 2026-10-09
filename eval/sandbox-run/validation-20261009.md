# Long-horizon runner development validation

2026-10-09. This records development validation before formal delivery, when holdout delivery was **0/24**. Current progress belongs to the [formal batch](long-horizon-20261009/README.md). See the [machine record](validation-20261009.json) and [protocol](protocol.md). Daily 3080 and earlier frozen results were not replaced.

## Implemented handoff

The main Agent creates a Task in native Standard mode and submits its plan. The reviewer reads a captured snapshot, forms checks, executes them, then compares against the main Session. The plugin controller owns decision application, node scheduling and bounded recovery. Python only supplies protocol-authorized approval/revision, renews resources, stops and collects. An external fixture or official scorer grades after execution without feeding failure hints back.

Each run uses a durable lease, reserved actions and original execution identity. Unknown responses require reconciliation rather than another delivery or grant. The absolute budget includes Host startup, planning, approval, review and recovery; resource renewal cannot extend it. Completion in the last polling gap is checked from settled native records after stopping, never from model claims.

## Actual runs and repairs

| Run | Outcome | Explanation |
|---|---|---|
| revision-5 | Infrastructure fault, reward=null | Shared private command copies rejected subsequent generated output. Each invocation now receives a fresh copy; the original failure remains sealed. |
| revision-6 | Internal plugin fault, fixture reward=0 | An unused checkpoint answer remained bound to an old revision after the edit barrier. It is retired and old queued callbacks are rejected. |
| revision-7 | Completed, external fixture reward=1 | One initial approval, exact revision and one revised grant; final count/sum/max correct. A completion timeout recovered once in the same job before completion. |
| fault-1 | Internal review fault, fixture reward=0 | The same job retried after injection but could not submit valid evidence before its second deadline; no rescue. The first external assertion also exposed an identity-recovery validation issue; its sealed result remains. |
| fault-2 | Task completed, fixture reward=0 | Same-job recovery completed with correct artifacts, but injection after a task-input read did not demonstrate artifact-read qualification inheritance. The strict development gate failed. |
| fault-3 | Completed, external fixture reward=1 | A timeout was injected after an artifact read acquired qualification. The same job/Session, cutoff and snapshot recovered once; prior qualifications survived, the node applied once and execution continued. |

Repair commits: [`1ae7cd6`](https://github.com/gosomea/dsh-task-supervisor/commit/1ae7cd66dc340b35aa8c5a918de4a56b4d52af18), [`b8dcfee`](https://github.com/gosomea/dsh-task-supervisor/commit/b8dcfeec28aa04eb9456452ac589d52698244af5), [`d9fa02c`](https://github.com/gosomea/dsh-task-supervisor/commit/d9fa02c305b9f780132ec677f26ecda45cd73f1f). Changes stay in the plugin or existing evaluation adapters, without modifying native sandbox, main loop or PTC deadline.

These rewards are fixture outcomes, not public official scores. New runs do not overwrite failures; controller completion does not prove every development gate.

The machine record retains an earlier pending `faultEvidenceRecoveryGate` placeholder and `checks.pythonSandboxPassed=51`. Final development recovery evidence is the actual identity, read-qualification and single-application checks in `development-fault-3.checks`, together with `strictFaultRecoveryPassed=true`; the final Python count is `sandboxPythonTestsPassed=60`. These fields neither overwrite earlier failures nor establish every subsequent formal recovery branch.

## Regression and browser

The full kernel suite passed 464 checks with 15 environment-dependent skips. Sandbox monitoring/collection passed 60 Python tests; official grading adaptation and score parsing passed 7 each. Four focused protocol tests passed; 144 other tests were filtered out. Host and Client strict typechecks passed. Controlled clocks and barriers cover deadlines, cancellation, budget persistence through replanning/restart, stale decisions, same-job evidence and duplicate grant refusal.

The browser verified complete decision bodies in the main Session, collapsed finished processes, separation of current review from previous decisions, real deadlines and fault counters. Actual reviews completed after more than 120 seconds. Screenshots and raw logs remain in the private registered environment; authentication URLs and credentials are not committed. A 480×900 viewport was checked for activity, deadlines, recovery counts and DAG scrolling. All four candidates passed native installation with the same final tarball, actual snapshot/check execution and credential-free, gateway-mount-free baselines.

## Resources and collection

Execution uses 2 CPU/8 GiB, independent checks 2 CPU/8 GiB and administrator 1 CPU/1 GiB. New delivery requires 30 GiB free Docker disk, 8 GiB free host disk and 5 CPU/17 GiB capacity. Main writable storage (20 GiB) and private checks (4 GiB) are sampled every 60 seconds; these are not hard quotas and cannot bound instantaneous peaks. Check CPU time remains null without reliable measurement.

Uncommitted/untracked artifacts are diagnostic; official submissions contain only Agent-committed base..HEAD binary patches. Settled check sources, copies and outputs are archived, gzip completeness and hashes verified, then owned volumes released. Unknown export responses reconcile original bytes rather than starting another export; incomplete exports remain faults. Fault-3 collection exposed reuse of the administrator state variable for checks, leaving a stopped administrator behind. Separate variables and original-ledger reconciliation release it with original records preserved and an added receipt. Grading requires collection of both artifacts and check storage.

Fifteen sealed, stopped old P2 containers were released after retaining base image identity, changed-file archives, deleted paths and private configuration. Original result hashes remain unchanged. Recovery materials stay private; container configurations must not enter public Git.

## Coverage gaps exposed by formal execution

The development recovery positives prove passage and continuation for the specified node and completion checks, not every decision branch. Formal execution subsequently reproduced a [plan-revision recovery version mismatch](long-horizon-20261009/supervisor-planning-recovery-gate-v6.json): a recovered revise retains the old plan version, while continuation requires an increment and stops further planning. The next candidate must separately verify recovered pass, revise and needs-user decisions, distinguishing planning permission from implementation permission. The current batch retains its frozen condition; development positives cannot establish that this branch passes.

Formal execution also preserves a [gap between tool acknowledgment and durable decision](long-horizon-20261009/supervisor-first-independent-stage-v6.json), and an [officially passing artifact with exhausted review-recovery budget](long-horizon-20261009/supervisor-budget-exhaustion-official-pass-v6.json). These respectively limit conclusions about durable application and review convergence. Original development outcomes remain unchanged, with new formal results recorded separately. Installation, tests or one successful development task cannot establish reliability of the entire long-horizon workflow.

## Remaining gates

The specified development recoveries and all four candidate admission gates passed. The 24-position order, installable tarball and runtime dependencies are frozen, and formal execution has started; see the [formal batch](long-horizon-20261009/README.md). Preserved admission failures occurred without model delivery. Per-position status and official results belong to that batch. After sealing all positions, report official reward, F2P/P2P when available, strict success, full denominator, costs and task-level uncertainty. Unlabelled false acceptance, false pause and correction benefit remain null.
