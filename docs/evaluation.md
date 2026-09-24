# Long-horizon evaluation proposal

**Status: study design.** No dataset, benchmark run, or superiority claim exists yet. This document owns the evaluation question and protocol; the [architecture](architecture.md) owns intended product behavior.

## Summary

The study asks whether DSH Task Supervisor keeps a coding task aligned with the user's instructions through long execution and reaches an independently accepted result more often than native DSH Goal or Plan. A faster or cheaper run is useful secondary evidence, but it does not substitute for task success.

## Comparison

| Arm | User-facing workflow under test |
| --- | --- |
| Native Goal | DSH's current Goal workflow on the pinned version. |
| Native Plan | DSH's current Plan workflow on the pinned version. |
| Task Supervisor | The proposed unified task workflow, entered through independent Supervisor commands (provisionally `/task`), with autonomous continuation and review. |
| Lead–Worker Team | A root Lead with native planning and Goal continuation delegates to one Worker and explicitly verifies its work; validate the combined preset first. |

Run a **product comparison** using each workflow as a user would normally invoke it. Run a separate **mechanism comparison** with matched model, tools, starting context, execution opportunity, and scripted user responses where possible. Keep these tracks separate in analysis: giving Plan an external continuation harness changes the product workflow but can isolate the value of supervision from the value of continuation.

The [Team comparison](prototype.md) is required to test whether Supervisor adds value beyond a capable Lead coordinating a Worker. Match evidence access and model allocation where possible, and report differences instead of attributing them to supervision.

## Dataset

Use pinned real repository coding tasks as the primary set. Each task needs a starting commit, an initial user request, explicit constraints, a reproducible environment, and acceptance checks independent of the agent's own summary. Add controlled pressure cases that exercise drift, repeated unsuccessful approaches, changed requirements, premature completion, and violations of explicit task constraints. Preserve the complete task input and expected evaluation rules before running any arm.

The same task definition and starting state go to each arm. During a run, do not provide improvised human hints; any required user response comes from a prewritten script applied consistently. Repeat tasks across seeds or equivalent run IDs and randomize arm order to reduce order and environment effects. Record model version, DSH commit, plugin commit, tool configuration, context limits, and host environment for every run.

## Reusing earlier evaluation designs

The local [forever-subagents evaluation design](../../../forever-subagents/docs/eval-design.md) supplies fixture, task, write-scope, checks, transcript, and run-result concepts. The [DSH harness design](../../../forever-fish/docs/harness-eval-design.md) supplies retrospective analysis, mechanism checks, and end-to-end comparison as separate layers. The [WorkDAG design](../../../forever-fish/docs/workdag-eval-design.md) supplies evidence-integrity checks and controlled recovery failures. These are source proposals, not proof that their proposed runners or datasets already work. The existing [trajectory analyzer](../../../forever-fish/eval/analyze_dsh.py) is candidate code; validate its parser against the pinned DSH event format before reuse.

| Earlier element | Supervisor adaptation |
| --- | --- |
| Dataset task, fixture, write scope, checks, provenance | Retain; add versioned user constraints, acceptance criteria, scripted changes, and external evaluation ownership. |
| Result, trajectory, and efficiency metrics | Keep separate; accepted constraint-respecting completion is primary. Do not carry over the old weighted efficiency score. |
| Evidence integrity and injected failures | Test stale review, unsupported completion, requirement changes, interruption, and recovery under the supervisor lifecycle. |
| DAG execution and parallelism metrics | Replace with stage progress, drift detection, recovery, and correct stopping for the single execution slot. |
| Trace and score export | Keep as an optional adapter. Local run artifacts must suffice to reproduce a result without a dashboard. |
| Old Jev implementation lessons and host checks | Reuse evidence about structured outputs, reviewer termination, and recursion prevention after revalidation. Website demonstrations are excluded from the prototype and evaluation fixtures. |

Historical public-benchmark counts, model scores, SDK commands, and infrastructure estimates in the earlier documents are not adopted as current facts. Verify primary sources and the actual environment before selecting or integrating a public dataset. This study continues to compare DSH workflows on a pinned DSH version.

## Three evaluation layers

First, curate historical failures into development cases and label the relevant objective, constraint, evidence, and first observable deviation. At a fixed checkpoint, show reviewers only the evidence prefix available then. Include normal progress and acceptable repeated attempts as negative cases; otherwise an always-critical reviewer can score well. Report missed issues, false alarms, evidence quality, and intervention choice. Offline replay measures judgment quality, not whether advice improves execution.

Second, run deterministic lifecycle and failure-injection scenarios in an isolated host. Their oracle checks state transitions, cancellation, durable recovery, and stale-decision rejection. Passing this layer establishes reliable control; it does not establish model capability.

Third, run the same held-out task fixtures through native Goal, native Plan, Supervisor, the Lead–Worker Team baseline, and the continuation-without-review diagnostic arm. Reviewers and the main agent must not access the external evaluator's private fixtures or labels. The production final evaluator is part of the tested system; benchmark scoring is a separate evaluation with its own evidence and checks.

## Task record and stage evidence

| Record part | Contents and visibility |
| --- | --- |
| Public task | Initial request, constraints, observable acceptance criteria, allowed changes, and necessary environment instructions; identical across arms. |
| Reproducible fixture | Pinned repository and starting snapshot, dependency environment, reset instructions, and provenance. |
| Evaluation package | External checks, reference outcomes, and evidence labels; protected from modification and withheld where they reveal the answer. |
| Scripted events | Requirement updates or injected failures with a predefined trigger and identical payload across arms; record whether the trigger was reached. |
| Run manifest | Workflow, model and reasoning settings, versions, execution limits, repeat ID, transcript, artifacts, and external scores. |

The agreed default for the formal end-to-end comparison is independent planning by every arm with the same external acceptance criteria and evaluation procedure. Every arm receives the same objective, constraints, and public acceptance requirements. Dataset milestones describe independently observable outcomes, not a hidden reference plan that only Supervisor receives. A stage definition should connect an objective to an artifact or check, with conditions for reopening it when affected requirements change. Score progress against common external evidence milestones rather than the number of self-declared completed stages. Giving every arm the same prescribed plan is a separate diagnostic experiment; report its results separately from the primary comparison.

Protect external evaluation checks; allow edits to project tests when the task permits them. Capture tracked and untracked artifact changes as well as test-integrity evidence. Do not automatically fail every project-test edit or rely only on a tracked Git diff. Trigger scripted changes at a predefined observable event or workload checkpoint, not at an improvised time chosen after seeing one arm's behavior.

Develop the first six pilot tasks from historical failures and ordinary successful work. Freeze a separate held-out set by repository or task family before tuning review policy. Repeat paired trials and report uncertainty at the task level; repeated runs of one task are not independent new tasks. Predefine treatment of infrastructure errors, interrupted runs, and resource-limit stops, retain every attempt, and report the full outcome denominator so retries cannot silently improve the score.

## First experiments

First validate lifecycle behavior in isolated DSH scenarios: capacity overflow, editing while a review is in flight, clearing while a continuation is queued, closing while a timeout is pending, restart with interrupted work, and fork without inherited execution permission. These checks establish control correctness; they do not establish better task completion.

Then pilot six task families before freezing the benchmark: a short repair, a multi-stage feature, a requirement change mid-task, repeated ineffective attempts, an unsupported completion claim, and a long stage with no reported milestone. The short repair checks whether supervision adds unnecessary work; the long-stage case checks whether milestone-only review misses drift. Pilot tasks are development data; reserve separate tasks for comparative claims.

Add a diagnostic ablation that keeps the same task state, planning, continuation, and model configuration but disables semantic review. Score its outcomes with the same independent evaluator. If improvement appears only against a baseline with fewer continuation opportunities, it does not yet show that review prevents drift. An optional cadence comparison can test stage review alone against stage review with the watchdog. Report interruption count and accepted completion together so excessive pausing cannot look like success.

## Primary outcome

The primary measure is the fraction of tasks that pass an **independent acceptance check while respecting the task's explicit constraints**. A task fails this measure if it claims completion without satisfying acceptance, violates a recorded constraint, or stops without a valid outcome. Acceptance checks may combine executable tests with blinded human review for requirements that tests cannot capture. Evaluators should not know which arm produced an artifact when practical.

## Diagnostic measures

| Measure | What to record |
| --- | --- |
| Drift and recovery | Evidence of objective or constraint drift, whether it was corrected, and how many rounds recovery took. |
| Completion judgment | Unsupported completion requests, accepted false completions, and valid completions rejected by the supervisor. |
| Intervention quality | True findings, false alarms, missed issues, unnecessary pauses, and user decisions requested. |
| Progress | Productive rounds, repeated attempts without new evidence, stalls, and total time to accepted result. |
| Resource use | Model tokens, reviewer calls, tool calls, wall time, and any additional monetary cost. |
| Resilience | Whether state can be reconstructed after restart and whether the task resumes only after the intended user action. |

Report per-task outcomes and failure examples alongside aggregate results. Predefine what counts as a violation, an intervention true positive, a stall, and a completed task before inspecting comparative results. Keep reviewer judgments and acceptance judgments separate so the plugin does not grade itself.

## Claim threshold

Do not claim the supervisor is better than Goal or Plan until the dataset, protocol, and acceptance criteria are fixed and all product arms have been run. Report uncertainty and task-family breakdowns, not only an overall win rate. A credible replacement should improve accepted, constraint-respecting completion without making false interventions or user interruptions unacceptable; the acceptable trade-off is an explicit study decision.

## Dev Note

Open study choices: task count and difficulty mix, exact DSH baseline versions, model and seed availability, time and token caps, how the Plan arm receives continuation in the mechanism track, blinded review rubric, statistical reporting method, and acceptable intervention rate. Pilot tasks should test whether acceptance rules are reproducible before the main comparison.
