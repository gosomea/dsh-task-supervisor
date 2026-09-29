# Agent Note: Planning supervision, truncation recovery and optional execution approval

Status: implemented

English | [简体中文](2026-09-29-planning-supervision.zh.md)

## Problem

A supervised task can exhaust a model response before submitting its plan. Earlier supervision waited for submission and could leave the task idle, with no evidence-based next output. A reviewer can also exhaust its response before recording a decision. Neither truncation establishes task success or a user decision.

The [first-seven evaluation analysis](../../../../eval/deepswe/results-20260929-7/analysis.zh.md) records native max-tokens endings without a submitted plan. The frozen experiment remains unchanged. These observations justify recovery and planning supervision, but do not establish that either improves independent reward.

## Decision

One plugin controller owns continuation and approval. Native Session events remain the source of truth; independent reviewers advise through durable structured decisions. The plugin changes neither native Goal/Plan nor the sandbox. The [validation record](../../../../docs/planning-supervision-validation.md) separates native-loop regressions, capped real-model probes and daily-configuration validation.

### Defaults and task controls

| Setting | Default | Effect |
| --- | --- | --- |
| `truncationRecovery` | `true` | Recover an admitted main generation at a settled native boundary. |
| `maxRecoveryWithoutProgress` | `2` | Pause repeated recovery without novel verifiable tool output. |
| `planningSupervision` | `true` | Observe investigation before plan submission. |
| `maxPlanningWithoutProgress` | `2` | Pause repeated observations without new relevant facts or resolved unknowns. |
| `executionApproval` | `manual` | `after-review` preauthorizes this task’s first execution after formal plan review passes. |
| `reviewRepairAttempts` | `1` | Bound protocol supplementation, including a settled reviewer truncation, in the same review Session. |

Profile preferences are captured in each task. Before first approval, `/task auto-approve-on` and `/task auto-approve-off`, sidebar buttons and explicit consultation directives change the durable task policy. Ordinary consultation does not grant approval. The UI exposes the effective policy and its source. Revocation remains available during review and invalidates the pending control decision.

`automaticContinuation: false` prevents automatic new turns, including main truncation recovery. Policy approval can be recorded without starting a new execution turn; explicit user resume is still required. Pause, off, restart and fork do not silently resume.

### Main-generation recovery

Recovery requires the latest actual native request to end with max-tokens, closed steps and tool obligations, no later activity, an empty inbox, an admitted current task and unchanged identity/version. A sticky earlier max-tokens marker cannot override a later successful request. Aborts, errors, blocks and interruptions use their own paths.

The controller persists the original turn, cutoff, fingerprint, count, exact input ID and contextual continuation, flushes before delivery, then rechecks identity, state and queues. A failed delivery withdraws that exact input before native maintenance releases the driver. Duplicate callbacks do not create another recovery. Restart reconstructs state and waits for manual resume.

Continuation names the objective, confirmed tool facts or accepted nodes, evidence references, missing output and current execution permission. It does not treat reasoning as executed work, replay uncertain effects or use token growth and repeated errors as progress.

### Supervision during plan formation

A planning review reads original main-Session evidence before a DAG exists. It distinguishes supported facts, unknowns and the next concrete output. Pass continues planning only; revise steers investigation; needs-user pauses for a user decision. Repeated identical facts cannot reset stagnation merely because a reviewer claims progress.

Observation uses existing thresholds: 24 tool results, completed tool activity across 5 minutes, or 3 consecutive tool errors at the next pre-step. A settled completed round without submission and a subsequent truncation can trigger an earlier check. These thresholds request review; they do not establish drift. Pure long generation is intervened on only at supported native boundaries.

New user input, pause, off or a changed task invalidates pending control application. Findings remain historical evidence. Internal faults remain review faults and cannot become user refusal or automatic pass. Planning review does not replace formal plan coverage.

### Optional execution preauthorization

Auto-approval requires a durable grant from the same main Session, task and requirements version, valid structure/provenance/dependencies, and an exact formal plan-review pass. It forces plan coverage even when `planCoverageReview: false`. Revise, needs-user, protocol failure or timeout never approve. The approved plan must match the reviewer input, not just its title or verdict.

Approval records source=policy, grant seq, plan version and review job ID. The controller does not fabricate a user message; `task_approve` retains its direct-user-approval checks. Competing manual and policy actions admit execution once. Editing requirements clears prior approval and preauthorization. Old records and a forked Session cannot grant this permission.

Completed-task repair still previews affected DAG nodes and waits for a user click each time. Auto-approval does not expand filesystem, network, sandbox or publishing permissions.

### Reviewer truncation supplementation

A settled latest native reviewer max-tokens ending can use the existing bounded protocol-repair path. Supplementation retains the same Session, task revision, cutoff, snapshot, read evidence and original deadline. It requests a structured decision from existing evidence; gaps remain revise or needs-user. Exhaustion pauses with the original Session and error sequence visible.

### Persistence and presentation

Task record 14 and projection 15 admit execution policy; review record 3 admits planning decisions. Readers accept legacy records without fabricating new authority. Main Agent responses remain native; compact Supervisor findings and task progress link to sidebar evidence and policy details.

## Alternatives considered

**Raise the output cap alone.** A higher cap reduces some truncations but cannot replace recovery.

**Continue after every idle.** This ignores approval, pause and unresolved tool effects.

**Review only submitted plans.** This misses stalls while a plan forms.

**Let the reviewer direct execution.** This creates a second continuation owner.

**Approve every task automatically.** Manual approval remains the default because automatic execution requires explicit preauthorization.

## Consequences

Three sequential batches deliver recovery, planning supervision and preauthorized execution without changing frozen evaluation results. Native-loop and real-model evidence are owned by the [validation record](../../../../docs/planning-supervision-validation.md); capped probes do not establish daily-configuration success. Daily CodeBuddy currently uses maxTokens=32000 and provider-default reasoning; the earlier 8192 probes are explicitly test caps.

Additional reviews and continuations cost time and tokens. These thresholds are not a measured optimum. Summaries can omit facts and reviewers can make incorrect recommendations despite valid citations; original evidence and independent outcome scoring remain necessary. Long-horizon improvement, correction yield and false pauses remain unmeasured without a new frozen comparison and blind annotations.

This note extends [review policy](../../../../docs/review-policy.md) and [Session runtime](../../../../docs/session-runtime.md). Related records remain active because their ownership and lifecycle rules still apply; no earlier history is overwritten.
