# Review budgets, incremental findings and user recovery

## Summary

Current source implements A deterministic correction, B scoped incremental findings and C asynchronous checks; D specialist review remains design-only. Changes are not released. See [validation](postmortem/2026-10-19-review-workflow.md) and [project architecture](architecture.md).

## Contents

- [User controls](#controls)
- [Budgets and scope](#budgets)
- [Findings and decisions](#findings)
- [Checks and recovery](#jobs)
- [Persistence compatibility](#persistence)

<a id="controls"></a>
## User controls

A review fault means no valid decision; revise reports unmet requirements; needs-user requires a user decision. The UI retains reasons and applicable actions.

| Action | Meaning |
| --- | --- |
| Retry review | Resume the same job within its identity and deadline; no budget reset. |
| Restart review | Create a new job and bind artifacts again; retain the fault. |
| Skip this review and continue | User release for the current fault, revision or decision checkpoint; later reviews remain enabled. |
| Skip review and approve this plan | One action approves the current complete plan, without a second approval. |
| End without final acceptance | Final checkpoint only; enters closed, does not count as success and cannot directly resume the task. |

Release does not rewrite results, fabricate a pass, change Host permissions or relax containers. Buttons bind a Task revision; actions retain job, versions, attempt, time and source. Models have no release tool.

<a id="budgets"></a>
## Budgets and scope

Ten minutes measures model attention, not a natural maximum test duration. Necessary tests still require inspection of assertions, execution paths, artifact identity and actual output. Static requirements can use reads; behavior needs execution or reproduction.

| Configuration | New-job defaults and bounds |
| --- | --- |
| reviewBudget.modelMs | 600000 ms; valid progress permits extensionMs=300000 extensions up to modelMaxMs=1200000. Repeated reads, polling and duplicate findings do not qualify. |
| reviewBudget.reserveMs | Default 60000 ms, reduced to one tenth for short budgets; finish from existing evidence without new inspection. |
| independentVerification.commandDeadlineMs | Default 300000 ms per command; administrators may configure up to 7200000 ms, which models cannot exceed. |
| reviewBudget.checksMs | Cumulative default 1800000 ms, maximum 7200000 ms; both command and cumulative limits apply. |
| reviewBudget.wallMs | Wall default 3600000 ms, maximum 10800000 ms, including preparation, model work, checks and recovery. |

Explicit reviewDeadlineMs preserves the legacy log-review total deadline and disables model extension; explicit independentVerification.deadlineMs preserves the independent total deadline. Old records retain deadlines and protocols. Earlier outer deadlines and cancellation win; configuration changes do not migrate in-flight jobs.

<a id="findings"></a>
## Findings and decisions

The controller determines applicable criteria; coverage errors list missing, extra and duplicate IDs together. Log mode saves findings with record_review_requirements and can cite result_ids; independent mode saves partial findings with record_review_observations, then finalizes with task_review_observations before reading main claims.

Confirmed blockers can yield an early revision or user decision; uninspected requirements are explicitly unverified. Pass still requires applicable original requirements and necessary checks. Three identical decision errors without new valid progress end the review and retain errors/findings; reviewInvalidDecisionLimit configures this bound.

Same-job retry reuses the Session, read eligibility, snapshot and partial findings without resetting budgets. Different jobs do not automatically copy passes; artifact, requirement or environment changes need fresh inspection. Final acceptance covers the whole result.

<a id="jobs"></a>
## Checks and recovery

Before execution, the new protocol persists UUID, Session, snapshot, argv, cwd and budget. The tool returns queued and ends the model turn; the controller awaits the original promise and delivers a receipt to the original reviewer Session. Each mutable check copy runs only one command at a time.

Gateway v2 retains admission and receipts; collect only collects and never creates commands. Duplicate UUIDs must retain identical input. Execution after disconnect remains bounded by the original administrator lease; explicit cancellation awaits cleanup. Restart first reads original receipts; missing reliable receipts remain unknown, never automatically rerun or guessed.

Only complete, actually read outputs bound to the correct artifact support verification. Timeout, cancellation, incomplete output, artifact mutation and infrastructure failures cannot become a pass.

<a id="persistence"></a>
## Persistence compatibility

New review records use version 9 and qualityProtocol=1, adding budgets, partial findings, error progress and check requests. Task records use version 16 with user releases, user-released nodes and closed termination; projection cache version is 22. Old records remain readable without rewriting logs. Older plugins cannot read new states; preserve logs and use old instances for old Sessions when downgrading.

## Optional specialist execution (D)

D remains disabled. The controller may later select one bounded executor for a capability gap: static inspection, tests or browser verification. It does not turn every review into a team.

| Contract | Design requirement |
| --- | --- |
| Input | Job and requirement identity, immutable snapshot digest, criterion IDs, allowed capabilities, deadline and cancellation signal. |
| Output | Per-criterion finding, original evidence references, executed check IDs, limitations and charged time; no Task state mutations. |
| Scheduling | Admit only within remaining model/check/wall caps and an explicit concurrency limit; specialists do not acquire another budget. |
| Conflicts | Conflicting findings stay unresolved until the owning reviewer checks originals; voting cannot manufacture a pass. |
| Recovery | Persist executor identity before dispatch, collect the original receipt, and retain unknown outcomes without automatic re-execution. |
| Enablement | Add capability admission, denial, cancellation, crash recovery and conflicting-evidence tests before exposing a profile setting. |

## Dev Note

Future cross-job caching must verify requirement, artifact and environment identities and retain provenance. A D specialist interface should accept scope, snapshot, capabilities, budget and AbortSignal, returning evidence references, findings, limitations and timing; no such executor is registered today.
