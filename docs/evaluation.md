# Long-horizon evaluation proposal

**Status: study design.** No dataset, benchmark run, or superiority claim exists yet. This document owns the evaluation question and protocol; the [architecture](architecture.md) owns intended product behavior.

## Summary

The study asks whether DSH Task Supervisor keeps a coding task aligned with the user's instructions through long execution and reaches an independently accepted result more often than native DSH Goal or Plan. A faster or cheaper run is useful secondary evidence, but it does not substitute for task success.

## Comparison

| Arm | User-facing workflow under test |
| --- | --- |
| Native Goal | DSH's current Goal workflow on the pinned version. |
| Native Plan | DSH's current Plan workflow on the pinned version. |
| Task Supervisor | The proposed unified task workflow with autonomous continuation and review. |

Run a **product comparison** using each workflow as a user would normally invoke it. Run a separate **mechanism comparison** with matched model, tools, starting context, execution opportunity, and scripted user responses where possible. Keep these tracks separate in analysis: giving Plan an external continuation harness changes the product workflow but can isolate the value of supervision from the value of continuation.

## Dataset

Use pinned real repository coding tasks as the primary set. Each task needs a starting commit, an initial user request, explicit constraints, a reproducible environment, and acceptance checks independent of the agent's own summary. Add controlled pressure cases that exercise drift, repeated unsuccessful approaches, changed requirements, premature completion, and high-impact actions. Preserve the complete task input and expected evaluation rules before running any arm.

The same task definition and starting state go to each arm. During a run, do not provide improvised human hints; any required user response comes from a prewritten script applied consistently. Repeat tasks across seeds or equivalent run IDs and randomize arm order to reduce order and environment effects. Record model version, DSH commit, plugin commit, tool configuration, context limits, and host environment for every run.

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

Do not claim the supervisor is better than Goal or Plan until the dataset, protocol, and acceptance criteria are fixed and the three arms have been run. Report uncertainty and task-family breakdowns, not only an overall win rate. A credible replacement should improve accepted, constraint-respecting completion without making false interventions or user interruptions unacceptable; the acceptable trade-off is an explicit study decision.

## Dev Note

Open study choices: task count and difficulty mix, exact DSH baseline versions, model and seed availability, time and token caps, how the Plan arm receives continuation in the mechanism track, blinded review rubric, statistical reporting method, and acceptable intervention rate. Pilot tasks should test whether acceptance rules are reproducible before the main comparison.
