# Long-horizon execution and paired evaluation protocol

This batch tests whether a supervised Task can continue, recover within its budget, and produce an independently accepted result. It starts from `de75f7a` and does not amend earlier benchmark results. [简体中文](protocol.zh.md).

## Execution and authorization

The plugin owns planning, reviews, bounded recovery, and continuation. A deterministic Python monitor owns initial approval, explicitly authorized development revisions, sandbox lifetime, collection, grading, and sealing. The monitor never sends a rescue prompt or resumes a paused Task.

Task budgets persist across replanning, review retries, and restart. Defaults are six truncation continuations and three transient review-fault retries per Task, with the existing two consecutive no-progress limits and one retry per review job. Budget reservations do not change the task revision bound to a review. User pause, shutdown, restart, and required decisions still need manual recovery. Every action remains subject to the original deadline.

The development revision case permits one initial approval and one authorization for the exact frozen revision. An event barrier holds the next node after the first accepted attempt. The monitor delivers the revision, waits for the new plan's applied coverage verdict, and authorizes that requirements version once. Public tasks have a fixed objective and at most one initial approval.

## Admission and immutable inputs

Use a supplied immutable package, fixed DSH/Node versions, pinned images, and private per-run homes. Verify native read, workspace write, execution, and denied writes before task delivery. An unusable permission sandbox is an infrastructure admission failure, not a reason to increase permissions.

Capture the baseline before credentials or model requests. Restore and compare fixture bytes. Connect the existing administrator check gateway through a task-private socket and artifact lease; only the administrator service has Docker control. Verify snapshots, independent checks, cleanup, official empty/reference grading controls, resource capacity, and actual main/reviewer model routes. A config dump or HTTP 200 alone is insufficient.

The monitor observes every 60 seconds, with durable-event barriers for time-sensitive actions. It reconnects to the original sandbox after interruption, renews its 60-minute lifetime below 15 minutes, and never extends the task deadline. Completion, deadline, exhausted budget, user decision, worker exit, or sandbox loss leads to collection and sealing. Started positions cannot be re-delivered; results cannot be overwritten.

## Public comparison and reporting

Select two Go and two TypeScript tasks from DeepSWE v1.1 commit `0b9fabbb63b9104d678fe965e1632f2dd9eaa2ea`, using the seed in `protocol.json` and metadata only. Exclude exposure and previously delivered tasks. Record admission failures and choose the next deterministic candidate only before model delivery. Freeze all four tasks, execution order, artifacts, profile, and grading before the comparison.

Run Goal, Plan, and Supervisor-independent twice per task: 24 positions, sequentially, with official task time and primary CPU/memory limits. Use the same main model route and reasoning settings. Report reviewer, gateway, and independent-check cost separately. Submit only the Agent's committed binary patch to the external official grader.

Report the full denominator, official reward, available F2P/P2P, controller completion, deadlines, internal/infrastructure/grading faults, all Session tokens, requests, review/check waits, recovery, repeated reads, human actions, and task-paired outcomes. Strict success requires timely controller completion, reward 1, and no infrastructure or grading fault. Unlabelled false-acceptance, false-pause, and correction-benefit metrics stay null. Four tasks do not establish superiority or general long-horizon performance.

## Implementation gates

Commit and push each accepted step: baseline/protocol; environment and check integration; plugin budgets; monitor and complete development runs; immutable installation and 24-position freeze; final report. `protocol.json` remains unadmitted until executed gate evidence and an immutable release are attached. Preserve the daily Host and retained test sessions.
