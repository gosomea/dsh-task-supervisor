# Supervisor interim analysis: seven sealed runs

## Scope and current conclusion

At the [twelfth result snapshot](reports/20261010-084126Z/report.zh.md), Supervisor had sealed 7/8 positions across four public tasks; repeated runs of one task are not separate independent tasks. The last Supervisor position is still executing and is excluded from this page. The Goal and Plan comparison is incomplete.

**The frozen version has performed independent checks, but has not reliably completed implementation, acceptance and task termination together.** Five runs received official scores: one full reward and four zero rewards. Two execution infrastructure failures retain null. Strict success is zero. The full-reward position paused after exhausting its recovery budget; official artifact correctness and controller completion must be reported separately.

This page is read-only analysis. The [machine record](supervisor-interim-20261010.json) binds the snapshot and original result hashes. It changes no plugin, execution input, authorization, deadline or score.

## Results by position

Official grading accepts only patches committed by the Agent. Uncommitted implementations remain available for diagnosis; the evaluator did not commit them.

| Task / repeat | Official reward | First stop | Independent command checks | Model requests | Main confirmed fact |
|---|---:|---|---:|---:|---|
| Updo / r2 | null | Infrastructure failure | 0 | 7 | Native request handling failed before independent artifact review. |
| Koota / r2 | 0 | Internal review fault | 23 | 197 | Node review timed out after retry; a tool returned recorded:true without a durable decision or release. |
| Geo / r2 | 1 | Recovery budget exhausted | 141 | 799 | The Agent's committed patch passed all 623 official tests; the controller did not complete overall acceptance. |
| Geo / r1 | 0 | Task deadline | 0 | 105 | Recovered plan review applied revise; a version check disabled further planning continuation. |
| Updo / r1 | null | Infrastructure failure | 19 | 180 | A race between private check cleanup and storage sampling stopped the outer runner early. |
| Koota / r1 | 0 | Internal review fault | 24 | 466 | Both node review attempts reached 600 seconds without durable independent findings or comparison. |
| Superjson / r2 | 0 | Internal review fault | 10 | 155 | Independent findings were recorded; two decision submissions failed before the review deadline. |

Superjson / r2 also encountered a collector ownership fault. After repair, grading used the original artifacts. This collection incident remains separate from the execution's first stop, counts as infrastructure failure and excludes strict success; its actual official reward=0 remains. Thus three infrastructure-affected positions overlap the five scored positions and cannot be added as disjoint groups.

## What the reviewer actually did

Five positions performed independent artifact checks. They produced 217 command checks, 61 durable independent findings and 2,147 reviewer tool calls. Across all Sessions, there were 2,811 tool calls and 210 tool errors. Reads, executions and persisted findings are counted separately; executing a check does not automatically establish requirement satisfaction.

[Koota / r2 evidence](supervisor-first-independent-stage-v6.json) records a check plan before reading deliverables and durable independent findings before opening main logs. [Geo / r2 evidence](supervisor-first-applied-independent-v6.json) also proves that an applied independent node decision preceded the main Agent starting the next node. These observations support implemented independent checking and handoff, but do not establish reliable whole-task acceptance or positive correction benefit.

[Superjson / r2 evidence](superjson-node-review-failure-r2.json) records 11 planned checks, nine read files, ten command checks and 11 durable findings. The first decision was rejected first by the check result cited for K3: that result recorded one change in its check copy and did not meet existing run-evidence qualification; a read criterion also mixed log references. The second submission omitted verdict. No valid decision resulted; an independent Session or model claim cannot establish completed acceptance.

## Cost and interpretation limits

The seven runs accumulated 1,909 model requests and about 10.07 hours of execution windows. This sums positions, including failures and waiting, rather than measuring seven parallel runs. Reviewer calls were about 76.4% of all tool calls; this does not determine token, CPU or main-Agent blocking shares.

Total tokens across all Sessions remain null; missing usage was not replaced with zero. Reported lower bounds are uncached-input 5,922,487, output 4,037,592, cache-read 140,050,941 and cache-write 0. Accumulated cache-read across requests is not one context length. Recorded human rescue actions are zero; initial delivery and protocol approval remain separate counters.

Without blind review or human causal labels, false acceptance, false pause and correction benefit remain null. Full official reward with a paused controller is mechanically observable, but does not alone label the pause incorrect. Complete paired and uncertainty analysis awaits all 24 sealed positions.

## Recommended repair priorities

The following are development recommendations after this batch; they are not implemented in its frozen condition.

1. **Planning continuation after recovery.** Validate version relations separately for pass, revise and needs-user. A revise that leaves the plan version unchanged should permit planning continuation without granting implementation permission. [Actual records and source reproduction](supervisor-planning-recovery-terminal-v6.json) support this gap.
2. **Decision acknowledgements and durable application.** A success receipt should distinguish submission from application. Test deadline races across submission, reviewer termination, log flush and snapshot freshness. A recorded:true receipt alone must not release downstream work, and a decision satisfying durable submission conditions must not be lost.
3. **Evidence and decision convergence.** Return locatable errors for missing fields, evidence-method mismatch and modified check copies; test correction with valid and invalid fixtures. Preserve evidence qualification, two-phase isolation and bounded budgets. Do not relax acceptance or extend deadlines to obtain a pass.
4. **Visibility of submitted artifacts.** Distinguish implemented, committed, reviewed and complete states, and expose uncommitted deliverables promptly. Confirm the product's intended artifact requirements before choosing prompts; the evaluator must not commit for the Agent.

Environment faults have separate [storage sampling](supervisor-storage-observation-fault-v6.json) and [collection ownership](repair-v10.json) repairs. Later positions continue from previously undelivered identities while original failures remain. These repairs are not Supervisor capability improvements.

## Evaluation continuation

The last Supervisor position uses its original Session and the frozen v10 runner. The controller retains one owner, one initial approval, the original official deadline, no rescue and immutable results. Normal product failures continue into the remaining Goal / Plan positions. Only confirmed runner, resource or grading faults stop new delivery for a separately recorded repair.

The final report will include all 24 positions, actual trajectories, paired results, costs and protocol deviations. Execution order was changed to prioritize Supervisor; condition and time confounding must remain explicit rather than claiming a fully randomized interleaved comparison.
