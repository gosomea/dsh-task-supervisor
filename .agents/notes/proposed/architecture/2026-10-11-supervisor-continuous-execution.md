# Agent Note: Supervisor continuous execution, review budgets and development regression

Status: proposed

English | [简体中文](2026-10-11-supervisor-continuous-execution.zh.md)

## Problem

None of the previous eight Supervisor runs reached overall acceptance. Failures included renewed 600-second budgets, findings not saved incrementally, disagreement between decision acknowledgement and durable state, blocked continuation after plan revision, and incomplete delivery.

The objective is for one Supervisor controller to advance an approved DAG through implementation, independent review, bounded recovery and repair within the original requirements, until overall acceptance and delivery. A required stop must record its reason and recovery action.

## Proposal

### 1. Record and lock the plan

The user authorized implementation on 2026-10-11. This proposed Note is the single decision owner until every acceptance gate passes. Update its English counterpart and pairing record together. Evaluation navigation and related documents link here rather than copying this plan. Retain the [planning-supervision Note](../../implemented/feature/2026-09-29-planning-supervision.md) and cross-link its still-valid responsibilities.

Locked decisions:

- Accept every node; trigger progress reviews on anomalies; advance serially by default and retain existing explicit Worker delegation.
- Persist each check finding; the controller aggregates requirement outcomes.
- Use phase budgets and early convergence; resolve the budget from workload, with 600 seconds as the default.
- Automatically repair and replan within the original requirements. Changed requirements need new authorization; reopening a completed task still requires impact confirmation.
- Reuse evidence whose artifact identity, coverage and dependencies remain valid.
- Complete only after all nodes, overall acceptance and requested delivery actions pass.
- Show activity, budget and next action in the main Session; retain the full report and independently folded native process.
- Pass deterministic and cross-artifact real-model gates before running the original four tasks twice each: eight Supervisor development regressions.

### 2. Continuous execution and decision handoff

The controller owns: DAG approval → ready-node dispatch → main Agent/Worker implementation → review submission → independent checks → sealed findings → comparison → durable decision application → continuation, revision or overall acceptance.

- Submission tools return promptly; the plugin controller runs reviews. Persist and flush a decision before acknowledging submission; record submission and effective application separately.
- Before applying, match Task, requirements version, plan version, node attempt, evidence cutoff and artifact identity.
- Durably reserve dispatch before handoff, then confirm. Reconcile unknown outcomes against the original action; never dispatch twice.
- Make plan recovery verdict-specific: pass enters approval/execution, revise returns to planning, needs-user waits. Planning continuation grants no implementation authority.
- At idle, reconcile running instances, unconfirmed actions, user decisions and ready nodes; fill a missing dispatch idempotently.
- Pause, close, new requirements and Task deadlines take precedence over old callbacks; Host restart requires manual recovery.

Progress reviews are triggered by consecutive tool errors, durable lack of progress, or explicit drift/new defects. Coalesce an existing review or node submission that covers the same issue. Retain existing planning-supervision triggers.

### 3. Workload budgets and the 600-second limit

Add reviewBudget configuration with a workload strategy and validated limits. Initial default tiers:

| Tier | Condition | Total budget |
| --- | --- | ---: |
| Light | Up to 4 deduplicated read-only checks; expected reads ≤256 KiB | 120 seconds |
| Regular | Up to 8 checks; reads ≤1 MiB; estimated commands total ≤120 seconds | 300 seconds |
| Complex or unknown | Above these limits or cost cannot be reliably estimated | 600 seconds |

Use scope and method, not task class. Unknown cost gets 600 seconds. The default automatic ceiling is 600 seconds; a higher ceiling requires explicit configuration. Fix the maximum absolute deadline at admission. Resolving the initial check plan may shorten it but must reserve at least 60 seconds for convergence/submission. Added checks, retries, replacement Sessions and protocol correction never extend the original deadline.

- First 70%: collect evidence and save findings incrementally. At 70%: stop expanding checks and consolidate coverage/gaps. By 80%: enter comparison and decision. At 100%: stop new work, cancel the instance and reject late decisions.
- For 600 seconds, convergence starts at 420 and decision by 480. The controller delivers transitions through public execution boundaries; cancel an over-boundary request, await settlement, then start convergence.
- Distinguish request timeout, command timeout, review deadline and Task deadline. Request/command recovery uses remaining budget; a review deadline never grants another budget.
- Command timeout is the minimum of its configured limit and remaining check time. Display/time post-deadline cleanup separately. Unconfirmed cleanup records a resource fault and forbids a replacement instance.

### 4. Incremental findings, evidence reuse and recovery

Add task_review_check_result for a check ID, outcome, actual evidence, coverage and limitations. Retain legacy batch tools.

- Persist a successful item immediately; retain revision history. Aggregate requirement outcomes from the plan and findings rather than requiring duplicate tables.
- Unfinished checks are unverified. Required failed/unverified outcomes cannot pass. Only successfully delivered original reads qualify; summaries, failed calls and model claims do not.
- Before findings are sealed, block main reports, implementation logs and prior decisions. Recovery inherits durable findings/actual read qualifications; reliably unavailable reads must be repeated.
- Bind cached verification to artifact identity, method, coverage and dependencies; a hit never expands coverage.

Keep one read correction, one protocol correction and one internal recovery by default, with separate counters. Prefer the original Session; allow one replacement when it cannot reliably continue, counted within that same internal-recovery allowance and job budget.

Write review record version 9 with budget, phases, incremental findings, Session lineage, decision receipt and fault history. Read versions 1–8 without inventing historical evidence, budgets or authority.

### 5. Repair, delivery and status

Repair/replanning within original requirements records its reason, affected nodes and permit origin. After coverage review passes, the new plan inherits still-valid original-requirement authorization without fabricating user approval.

Persist limits: at most 3 automatic replans per Task and 3 automatic reworks per node; stop after two consecutive rounds without new relevant artifacts or verification results. Retry, replan, restart and manual recovery never reset counters.

Overall acceptance binds the current full snapshot and checks changes, interfaces and omitted requirements. Revalidate reused evidence identity/applicability; never add up prior node verdicts. Completion requires:

1. Every current DAG node effectively passes.
2. The current whole artifact passes acceptance.
3. Requested commit, push, export or file delivery is actually complete.

Main Session, DAG and sidebar share activity interpretation: node, owner, concrete activity, latest activity, remaining budget, recoveries and next action. Distinguish submission, application, stale results, fault, user wait and cleanup. Preserve native main-Agent replies.

### 6. Mandatory implementation order

| Step | Deliverable | Release gate |
| --- | --- | --- |
| 0 | Complete tree, Note, baseline and protocol | Complete tree at 2edbbc3; src/kernel equal 44b2a42; preserve unrelated edits |
| 1 | Durable decisions, idempotent application, plan revision continuation, missing dispatch | Cancellation, duplicate callback and lost-response regression |
| 2 | Workload budget, convergence, fixed deadline, cleanup | Controlled clock verifies no renewed budget or late application |
| 3 | Incremental findings, aggregation, read inheritance, reuse | Positive/negative fixtures and phase isolation |
| 4 | Automatic revision, delivery, shared UI | Multi-node full loop and browser acceptance |
| 5 | Frozen package, eight Supervisor regressions | Clean install, admission and independent grader controls |
| 6 | Machine records, bilingual documentation, Chinese report | Full denominator, missing data and traceable failures |

Before each separate commit/push, update evidence and bilingual current-state docs. Verify the remote ref. Evidence records commit identity, command, exit code, result location and limitations. A failed gate blocks the next step. Mark only verified behavior implemented; move this triplet to implemented/architecture only after all work passes and rewrite it as actual decisions/consequences.

## Alternatives considered

**Renew 600 seconds per attempt.** Workload budgets with one fixed deadline avoid repeated allocations to the same job.

**Submit every finding at the end.** Incremental persistence avoids losing all findings to one final validation error.

**Repeat all checks or sum node passes.** Valid evidence is reused while changes, interfaces and omissions are checked again.

**Confirm every revision.** Original-requirement repair/replanning proceeds automatically; changed requirements and completed-task reopening still need authorization.

**Default automatic parallelism.** Serial completion retains explicit delegation and reduces concurrent writes/snapshot invalidation.

**Run fewer regressions or unseen tasks.** The original four tasks twice each directly exercise observed failure paths.

## Acceptance criteria

- Deterministic tests cover durable acknowledgement, duplicate application, fixed budgets, phase transitions, pause/restart, changed artifacts, read inheritance and cleanup.
- Correct multi-node fixtures complete all nodes, acceptance and delivery; incorrect artifacts cannot pass and unrelated preferences cannot reject valid artifacts.
- Real-model fixtures cover static documents, calculations, behavior omissions, misleading reports and missing capabilities; identify injected faults separately.
- Host/Client strict checks, kernel regression, build, package and ordinary clean DSH installation pass.
- Browser acceptance covers activity, full reports, narrow screens, long logs, multiple Tasks, refresh and released history subscriptions.
- Run only Supervisor for four original tasks twice, in a new batch with clean baselines, original prompts, frozen config, one initial approval and official deadlines; no rescue prompts.
- Grade only Agent-committed patches. Seal all eight positions without overwriting results, including unsubmitted positions with reasons.
- Report reward, strict success, controller state, total review wall time/phases, reasons over 600 seconds or configured budget, coverage, faults, recovery, repeated work, user actions and all available Session usage.
- Confirmed implementation/grading defects stop new submissions; repairs get a new version/batch. Ordinary task failures continue; never overwrite or pool incompatible results.
- Push code, protocol and sanitized evidence; enumerate unexecuted gates. Unverified work cannot be reported as accepted.

## Risks

Convergence can increase unverified outcomes; measure coverage and correctness together. External cancellation can lag: record actual cleanup time rather than equating a stopped UI with released resources.

These tasks are exposed development regressions, not unseen performance or superiority over Goal/Plan. Without human labels, false acceptance, false pause and corrective benefit remain null.

Changes stay in Supervisor and its evaluation adapter, using public DSH APIs, snapshots and the existing check runner. Preserve in-flight daily 3080 tasks. Independent browser execution and new automatic parallel scheduling are excluded.
