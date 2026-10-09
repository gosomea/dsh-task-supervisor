# Review and intervention proposal

Current recovery defaults and visible activity are documented in [native review process and recovery](review-experience.md): timeouts and recognized transient request failures retry once, with continuation only under a valid original permit. User pauses, disabling, restarts and decision pauses stay manual. Protocol supplementation and fault recovery have separate counters and grant no new permission.

**Status: design proposal.** This page owns task review, checkpoint timing, evidence access, and intervention. The proposed thresholds are provisional and need calibration on real tasks.

**Prototype status (2026-09-27):** Plan submission now runs an independent coverage review; stage, progress, and completion reviews still use fresh reviewer Sessions. The prototype adds `read_task_call` for inspecting tool arguments and lets a plan declare `read_only_turns_before_write` to enforce a completed read-only turn before writing. General action-order enforcement and configurable user-decision timeouts below remain design goals.

## Summary

Review the task's objective, constraints, stage progress, and completion evidence. The main review checkpoints are plan readiness, stage transitions, and final acceptance. Routine tool calls do not need a model review. DSH continues to own baseline tool permissions; the current prototype adds a deterministic write gate for a declared read-only-turn requirement. Other action constraints still depend on reviewer judgment.

## When review runs

| Checkpoint | Purpose |
| --- | --- |
| Initial plan ready | Check coverage of the user's objective, constraints, stages, and acceptance criteria before the user reviews the plan. |
| Stage claimed complete | Check the expected evidence and decide whether the next stage is ready. A main-agent claim is not sufficient by itself. |
| Objective edit or material plan revision | Reconcile affected requirements and stages; user-authorized changes take effect without a second synchronization confirmation. |
| Final completion request | Evaluate every acceptance criterion against current artifacts and evidence. |
| Missing progress or an extended stage | Trigger an independent review even when the main agent never reports a stage transition. |

At ordinary round boundaries, the controller checks task state and whether a review is due. It does not necessarily call a reviewer. As a provisional watchdog, request a review after three execution rounds or twenty tool results since the last accepted review, whichever comes first. During a long round, deliver it at the next supported safe step boundary. Count events cheaply; do not review every tool call. Repeated failed checks can trigger an earlier review, but repetition alone does not prove stagnation. Exact thresholds and boundary support need validation.

At a required checkpoint, hold new task steps at the supported boundary until the review resolves; allow already-started tools to settle. New user instructions take priority and invalidate an obsolete review decision. Coalesce simultaneous triggers into one review for the same task revision and evidence cutoff. Start a fresh reviewer at each checkpoint by default; call a specialist only for a concrete unresolved issue. A reviewer cannot independently schedule main-agent work. Its output identifies the task and plan versions, evidence cutoff, findings, and recommended next action.

Review follows the main Agent's effective model selection by default or uses a model selected from the active DSH profile; each job pins its resolved configuration under [reviewer model policy](review-model.md). Recovery reconciles previous jobs through [Supervisor Session](session-runtime.md); restart or history inspection does not authorize a new review.

## What each review decides

The reviewer checks four things: whether work still serves current instructions; whether this stage produced useful progress; whether its expected evidence exists; and whether the proposed next action follows from that evidence. A stage can pass, need revision, or need user input. A missing acceptance result is actionable; a stylistic preference outside the user's criteria is not grounds to keep a finished task running.

| Finding | Proposed default response |
| --- | --- |
| Minor observation with no required change | Record only. |
| Evidence-backed drift, missing evidence, or a recoverable failed approach | Deliver an automatic correction and let the main agent revise its next step. |
| Contradictory requirements or a decision only the user can make | Pause and show the exact decision needed. |
| Confirmed stagnation after attempted correction | Pause until the user manually resumes or changes direction. |

The three configurable tiers remain record only, automatic reminder, and pause for user decision. Severity rules may raise a finding's tier. A finding cites instruction or plan versions and supporting event IDs. A pause explains the concrete consequence and available choices. It must not invent a new acceptance criterion.

## Pause and timeout

Tools durably submit plan, node and whole-task reviews; Supervisor runs them after the current turn settles. See [review-job lifetime](review-queue.md). A review deadline is an internal fault, never automatic permission to continue, approve or complete.

Stage review normally holds the next continuation or stage transition, not an arbitrary tool call. The user may continue the proposed next step, accept advice and return the task to replanning, or stop. An automatic reminder is delivered through a logged main-agent instruction. Corrective continuation must change the next step or supply useful missing evidence; repeatedly delivering the same reminder is not progress.

For ordinary review prompts configured with a timeout, keep the agreed default: timeout permits the held next step and records automatic continuation. The exact duration remains open. Immediately before continuation, recheck task revision, supervisor enablement, execution permission, and newer user input. A stale timeout never revives an edited, stopped, or cleared task.

Initial plan approval, an unresolved essential user decision, confirmed-stall recovery, manual pause, restart, and disabled Supervisor do not receive this timeout permission. Timeout cannot mark a task complete or grant a separate DSH permission. Accepting review advice cancels the held continuation and gives the main agent a concrete replanning instruction.

## Evidence access

The session read tool is bound to the main session. Its first view is the last completed round; the reviewer expands backward or reads from its persisted cursor to cover the entire unreviewed interval. Returning only the latest round is insufficient when a stage spans several rounds. Freeze an evidence cutoff for each review, retain stable event references, and require missing pages to be read before the cursor advances. Longer redacted messages and tool inputs or outputs are expanded on demand.

Later user edits invalidate control decisions based on older task versions. Later execution evidence stays pending for another review; findings may be retained as historical observations but cannot approve work beyond their cutoff. The tool cannot select an arbitrary session or write into the main session. Reading task state does not replace reading the original evidence.

## Final acceptance

The final evaluator checks original user requirements against the actual workspace result. Plan criteria organize checks and cannot weaken or omit those requirements. An isolated copy must include relevant committed, uncommitted, and untracked task artifacts; checking only repository HEAD could validate a different result. Record artifact identity, commands, outputs, and limitations. Pin the result to the task version and tested artifact snapshot; later relevant changes invalidate it. Earlier node passes cannot establish acceptance of the combined delivery.

The evaluator returns accepted, needs work, or needs user evidence. The controller records completion only for an accepted result with all required criteria supported. Infrastructure failure or missing credentials do not prove acceptance failure or success; they produce an explicit unresolved result. The evaluator can request repairs for unmet criteria but cannot expand scope with optional improvements. Its checks never modify the main workspace.

## Decision record

Persist review inputs, output, cursor advancement, intervention, and delivered messages through session events. Each decision has an identity and revision check so duplicate callbacks do not apply it twice. Reviewer errors or malformed output do not count as a passing review. Required reviews hold continuation while recovery is attempted; exhausted recovery waits for the user. Restart behavior follows [task lifecycle](task-lifecycle.md).

The [generic enhancement plan](review-quality.md) distinguishes claims, execution logs and independently acquired evidence. Reviewers select methods from original requirements; an independent Session alone does not prove independent verification.

## Implemented generic protocol

`reviewVerification: log | independent` selects the effective acceptance mode. Omission preserves legacy behavior without invented evidence. Independent mode describes snapshot reads and isolated commands; independent browser observation is unavailable. Known required capabilities can be prepared through `requiredVerification` before delivery; plan-declared needs are prepared before implementation approval. Reads do not require a command runner, and missing necessary capability cannot silently fall back to passing log review.

The reviewer reads the complete objective, necessary original input and constraints, lists artifacts and capabilities, then records requirement sources, facts, methods, expectations and coverage through `task_review_check_plan`. Explicit requirements remain distinct from hypotheses. Deliverable expansion and execution are gated until the initial plan exists. Checks may be appended with retained revisions, without task-category templates.

After `task_review_observations` persists every check's results, acquired evidence, coverage and limitations, main reports, execution logs and historical conclusions become available. Comparison investigates discrepancies; `task_review_decision` cites this job's actual reads or runs. Explicit failures and unverified requirements prevent passing; unsupported preferences cannot block correct delivery. Exit status, file existence and test counts alone cannot establish satisfaction.

`read_task_evidence_index` provides a cutoff-bound filtered/paginated redacted locator, linked calls/results, errors and truncation markers. Formal citations still require original-event reads. The side panel shows four phases and per-requirement inspection; metrics cover tool calls, repeated reads, durations, actual execution and all Session tokens. Existing progress-review frequency remains unchanged.

Review record version 5 and projection cache 16 preserve legacy readability. New jobs pin artifact snapshots; repair/recovery retain job identity. See [validation](../eval/independent-verification/generic-quality-20260930/README.md) for actual evidence and capability boundaries.

## Dev Note

Independent snapshots, verification before report comparison, bounded checks and confirmed reopening into the original DAG have isolated development validation; independent browser journeys remain pending. See [implementation status](implementation.md) and the [original plan](10-plans/independent-verification/plans.md). Historical reviews are not retroactively labelled independent executions.

Protocol repair, fault versus user-decision classification, failed-review identity and progress observations are implemented; see [implementation status](implementation.md). The [original plan](10-plans/conversation-and-review-recovery/plans.md) retains design scope. Observation benefits still require independent evaluation; frozen scores remain unchanged.

Calibrate watchdog thresholds, severity rules, timeout duration, false-positive suppression, and transient review retries. Verify safe step-boundary scheduling, event pagination, redaction, workspace-copy fidelity, and host user-decision transport in an isolated DSH instance before fixing tool schemas.

### Execution-record requirements during comparison

Operation order, authorization and source facts are authoritative in the bound Session. A check may use `method: log`, remain unverified during independent discovery, then cite `seq:<N>` after fully reading cutoff-bound original events during comparison. Locator summaries, failed reads, partial pages and truncated results cannot support passing this check. Independent observations remain unchanged; final results retain actual read ranges and identify this method as log comparison, not independent execution.

Log references cannot establish independent calculation or behavior checks. `read` still requires complete artifact reads; `run` still requires an actual successful check of the current snapshot and complete outputs. Passing Session references to either method is rejected. This repair addresses an evidence gap encountered when the revision fixture required a later verification tool call; review frequency and execution permissions are unchanged.
