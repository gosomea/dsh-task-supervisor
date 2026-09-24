# Task state and control proposal

**Status: design proposal.** This page owns task capacity, storage, command routing, and recovery. The proposed defaults below are starting points for implementation, not measured limits or shipped configuration fields.

## Summary

Each session has a bounded task list and one execution slot. The proposed default is five unfinished tasks, configurable to another positive limit. Draft, queued, paused, and waiting tasks consume slots; completed or cleared tasks move to history. Stages within a task do not consume additional slots. Reaching the limit rejects creation with a direct explanation; it never silently removes an unfinished task.

The right-hand Supervisor panel shows the selected task, current executing task, stage, evidence, latest review, and next action. Selecting a card changes the command target, not the running task. Starting another task waits until the current execution releases its slot. Each command records the selected task ID and revision when submitted so a later UI selection cannot redirect it.

## One state file

Use one `supervisor.json` snapshot per session in host-managed session storage, outside the main agent's working tree. JSON supports strict validation, stable IDs, and revision checks. Markdown is an optional generated export for reading; it is not a second writable task store. The exact host storage API and location still require verification. [Supervisor Session design](session-runtime.md) owns external-event integration, durability barriers, stale-inbox reconciliation, and execution restrictions when the controller is absent.

The existing DSH session log remains authoritative for user instructions, execution evidence, and durable supervisor events. Commit an accepted state change to the log before admitting dependent work; derive the JSON snapshot and panel from that committed prefix. The JSON file contains a schema version and source-event cursor, is replaced atomically, and can be rebuilt if missing or stale. This avoids an extra event journal and avoids making a partially written file the authority. External file edits are not imported automatically.

| Snapshot content | Purpose |
| --- | --- |
| Session identity, schema version, revision, event cursor | Bind the snapshot to its source and detect stale updates. |
| Supervisor enabled state and selected task ID | Restore the visible controls without granting continuation permission. |
| Bounded task records | Store stable ID, origin, objective, constraints, acceptance criteria, lifecycle status, and queue order. |
| Current plan and stage | Store version, stage objectives, expected evidence, and stage status. |
| Review and decision references | Point to logged findings, unresolved user decisions, and evidence cursors. |

Full transcripts and old plan versions remain in the session log. The snapshot keeps the current view and references, not an ever-growing copy of that history. Automatic continuation permission is disarmed on process or session startup even when the snapshot shows an enabled supervisor.

## Commands go to the Supervisor

Both slash commands and panel controls submit the same durable control requests. The right panel acknowledges receipt, shows any pending application, and displays the resulting state. The server applies requests even when the panel is collapsed or no GUI is connected. Requests carry idempotency identity and task revision; retries cannot create duplicate tasks or repeat a control action.

`/task new <objective>` creates a task and queues it when another task owns the execution slot. `/task plan <request>` creates a planning draft under the same capacity limit; bare `/task plan` opens or revises the selected task's plan. Queued drafts do not send instructions into another task's active round. The main agent plans when that task is admitted. An approved task may continue across rounds; starting another queued task requires its own approved plan and an explicit start or prior queue-start authorization. Simply adding it to the list grants neither.

`/task edit` records the user's update immediately, increments the task revision, and invalidates queued continuations and review decisions based on the older revision. The Supervisor delivers the update to the main agent at the next supported steering boundary. The main agent proposes a revised plan; retain still-applicable completed stages and evidence, and reopen only affected acceptance checks. The user does not confirm an artificial synchronization step. Already-started tool effects remain facts in the log and cannot be retroactively cancelled or labelled as new-plan work.

`/task plan off` exits planning, withdraws the pending plan approval, and retains the latest draft and its history. Re-entering planning can reuse the draft after checking current instructions. Exiting neither approves execution nor silently resumes the preceding execution phase; that task waits for an explicit start or resume. A task whose first plan is still unapproved must obtain that approval before autonomous execution.

## Clear, recreate, fork, and restart

| Operation | Proposed effect |
| --- | --- |
| Clear the selected task | Mark it cancelled, remove it from the unfinished list, invalidate its queued work and decisions, cancel its supervisor-owned running round, and preserve history. It is not a successful completion. |
| Recreate after clear or completion | Allocate a fresh task ID and new initial plan. Reusing old text or artifacts is explicit; old approval and completion evidence are not silently inherited. |
| Pause a task | Disarm continuation and cancel supervisor-owned execution through host cancellation; preserve partial results and the plan. |
| Resume a task | Reconcile newer user messages and workspace changes before admitting work; unresolved first-plan approval and required user decisions still apply. |
| Fork a session | Copy task state from the selected durable prefix into child task identities with parent references; leave unfinished child tasks paused and invalidate inherited pending approval requests, timers, and in-flight review work. The parent is unchanged. |
| Restart or reopen a session | Rebuild state, show unfinished work as awaiting manual resume, and reconcile any interrupted execution. Never replay a tool call merely because its result was not recorded. |

A fork copies neither running processes nor external effects. An already approved plan retains its historical approval record; manual resume grants the child its own execution permission. The child reviewer may read inherited evidence only within the allowed session prefix; completion checks must use the child's current workspace. Forking a session does not itself isolate the workspace, so workspace ownership must be checked before child execution resumes.

## Close Supervisor

The panel exposes a clearly labelled **Close Supervisor** control separately from **Pause task**, **Clear task**, and collapsing the panel. Closing persists the disabled state, disarms continuation, cancels reviewer jobs and queued supervisor work, and invalidates pending timeout actions. A running supervisor-owned round receives ordinary host cancellation; the UI shows stopping until it settles. Completed effects are not rolled back, and unrelated user-started work is not cancelled.

Reopening the panel only shows state. Explicitly enabling Supervisor restores its controls, but tasks remain paused until resumed. A new task-creation or planning command while disabled records its request and shows that supervision is off; it does not silently enable execution. Ordinary conversation remains available while Supervisor is disabled.

## Next-round admission

The controller can start the next round only when Supervisor is enabled and explicitly armed, the task has execution authorization, the main agent is idle, newer user input has been handled, no required review or decision is pending, and task state has been persisted. It reserves one continuation against the current task revision and rechecks that revision at admission. An edit, pause, clear, close, or newer user request invalidates the reservation. Review timing is owned by [review policy](review-policy.md).

The next-round instruction includes the current objective and constraints, current stage, accepted evidence, and one concrete next action. The instruction is logged and attributed to the task. Unknown execution results, confirmed stagnation, and reviewer failure leave an explicit recovery state rather than producing empty automatic rounds. Retry counts for transient reviewer failures require isolated-host validation.

## Dev Note

Verify storage APIs, event registration, active-session steering, cancellation boundaries, and fork-prefix references in DSH before fixing schemas. Initial task capacity is five; calibrate it from actual use. UI wording and queue-start authorization need prototype feedback. The initial version starts its own tasks; importing native Goal or Plan state is optional future work, not an activation requirement.
