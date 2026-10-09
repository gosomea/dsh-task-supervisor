# Long-horizon runner development validation

2026-10-09. This is development validation; formal holdout delivery remains **0/24**. See the [machine record](validation-20261009.json) and [protocol](protocol.md). Daily 3080 and earlier frozen results were not replaced.

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

## Regression and browser

The full kernel suite passed 464 checks with 15 environment-dependent skips. Sandbox monitoring/collection passed 55 Python tests; official grading adaptation and score parsing passed 7 each. Four focused protocol tests passed; 144 other tests were filtered out. Host and Client strict typechecks passed. Controlled clocks and barriers cover deadlines, cancellation, budget persistence through replanning/restart, stale decisions, same-job evidence and duplicate grant refusal.

The browser verified complete decision bodies in the main Session, collapsed finished processes, separation of current review from previous decisions, real deadlines and fault counters. Actual reviews completed after more than 120 seconds. Screenshots and raw logs remain in the private registered environment; authentication URLs and credentials are not committed. A 480×900 viewport was checked for activity, deadlines, recovery counts and DAG scrolling. Final frozen installation remains pending.

## Resources and collection

Execution uses 2 CPU/8 GiB, independent checks 2 CPU/8 GiB and administrator 1 CPU/1 GiB. New delivery requires 30 GiB free Docker disk, 8 GiB free host disk and 5 CPU/17 GiB capacity. Main writable storage (20 GiB) and private checks (4 GiB) are sampled every 60 seconds; these are not hard quotas and cannot bound instantaneous peaks. Check CPU time remains null without reliable measurement.

Uncommitted/untracked artifacts are diagnostic; official submissions contain only Agent-committed base..HEAD binary patches. Settled check sources, copies and outputs are archived, gzip completeness and hashes verified, then owned volumes released. Unknown export responses reconcile original bytes rather than starting another export; incomplete exports remain faults. Fault-3 collection exposed reuse of the administrator state variable for checks, leaving a stopped administrator behind. Separate variables and original-ledger reconciliation release it with original records preserved and an added receipt. Grading requires collection of both artifacts and check storage.

Fifteen sealed, stopped old P2 containers were released after retaining base image identity, changed-file archives, deleted paths and private configuration. Original result hashes remain unchanged. Recovery materials stay private; container configurations must not enter public Git.

## Remaining gates

Strict fault recovery passed. Actual snapshot/check integration and mount-free baselines for all four candidates, then final tarball freeze and clean installation must pass before the 24-position batch starts. After sealing all positions, report official reward, F2P/P2P when available, strict success, full denominator, costs and task-level uncertainty. Unlabelled false acceptance, false pause and correction benefit remain null.
