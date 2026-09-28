---
title: "Rework explanations and main-node execution validation"
description: "Checks of rework causes, prior acceptance, explicit start tools, and older Session recovery."
status: "verified"
date: "2026-09-28"
---

# Rework explanations and main-node execution validation

## Behavior and rationale

Integration can expose a defect after a node passes. `task_rework_node` opens a new attempt and invalidates its dependent descendants; the earlier pass remains a historical fact and cannot accept the new attempt. The main Session shows a short rework notice, node status, attempt number, and cause; the sidebar retains the full reason, prior state, affected nodes, and prior review.

Before implementation, the main Agent calls `task_start_node(stage_id, attempt)` to record its execution Session, start time, and `running` status. Repeating the same running attempt does not advance the revision; stale attempts, unmet dependencies, stopped tasks, and another running main-Agent node reject a start. Delegated nodes retain their existing execution records. Ordinary questions and Session activity never imply a node start.

Successful native rework calls and results supply the explanation. The projection accepts task snapshots in older results; new results also retain exact pre-call states. Rejected calls produce no rework record. The projection retains the latest 50 reworks and reviews without fabricating discarded review bodies. Historical tasks remain available on demand from the same native log.

## Automated checks and older logs

- After integration with the latest review recovery implementation, 9 kernel files and 83 tests passed; strict Host and Client typechecks and the Node 24 build passed.
- New regressions cover older/newer rework results, rejected calls, descendant invalidation, independent-node preservation, main-Session notices, attempt matching, dependency checks, idempotent starts, and ordinary questions leaving state unchanged.
- Read-only replay of the user's `session-8119cd90-08dd-41ef-bdb2-c2540c3d4d17` through seq 989 reconstructed n1 from passed attempt 1 to attempt 2 using the seq 987 call and seq 989 successful result; n3/n4 were affected and n2 remained passed. The original log and game files were not rewritten.

## Real model and browser

The registered `supervisor-rework` environment uses a TMP workspace and CodeBuddy's `deepseek-v4.1-flash` route. The original 59909 long task and daily DSH remained running. Automatic continuation was disabled in this test configuration to inspect the UI between nodes; this case does not establish automatic scheduling or long-horizon quality.

The valid case is `session-ff0135c4-e179-4272-adc8-08f42f998293`, task `97a393de-a520-4561-9725-b4d946b374bb`. The native command controller created two nodes: n1 writes and verifies the 6 UTF-8 bytes of “你好”; n2 depends on n1 and documents the checks. The test operator approved the reviewed initial plan.

| Main Session evidence | Result |
| --- | --- |
| seq 47, `task_start_node(n1, 1)` | The main Agent began implementation and the node showed executing. |
| seq 75, first node review | The model used temporary files outside the workspace; the reviewer withheld acceptance and paused for user judgment. |
| seq 89, 112, 120, 143 | The test operator explicitly exempted the cleaned temporary files; after manual resume, attempt 2 began and its read-only verification passed. The exception applies only to this case. |
| seq 158–160, `task_rework_node(n1)` | Passed attempt 2 became attempt 3 awaiting rework; n2 advanced from attempt 1 to attempt 2, waiting for its dependency. |
| seq 169–171, `task_start_node(n1, 3)` | The running state was recorded before the new read-only hexadecimal assertion; the reworking label is covered by the kernel regression. |
| seq 187 | Attempt 3 passed review; n2 remained unexecuted and the whole task was incomplete. |

The native browser page showed short main-Session notices and DAG attempt numbers; hover revealed the rework cause. Clicking “View rework” opened the corresponding sidebar node. Native disclosures revealed the prior accepted review and affected nodes; main-Agent answers retained their native presentation.

![Main-Session rework summary and sidebar records](assets/rework-attempt-details.png)

After integrating the review recovery code and rebuilding, the test Host restarted. Saved attempt 3 acceptance, the rework cause, the attempt 2 accepted review, and downstream attempts were restored with `armed=false`; execution did not resume automatically. Older logs without new review-job records remained readable without fabricated jobs.

## Validation scope

This validates node state and rework explanations, not a long-horizon comparison. Initial preparation mistakenly sent `/task new` through the ordinary prompt API as text, which did not dispatch the command; that preparation Session was cancelled and the valid case used the native command controller. Its diagnostic work is excluded from the feature evidence.

Explicit starts depend on the main Agent using the tool; older behavior without a native start record is never guessed to be executing. This work was validated on an independent branch and isolated instance without replacing the running original 59909 deployment.

[简体中文](rework-progress-validation.zh.md)
