# Tool access after a PTC task completes

## Failure

The daily Session `session-d7c2d2d9-b4d4-48cd-834e-215c60c24387` produced seven tool errors on 2026-10-07: four during a completion inquiry and three after an explicit new-task request. PTC exposed only `run_code`; the completed-task guard rejected this arbitrary-program entry point before inner `read`, `task_status` or `task_create` calls could execute. The attempted creation also omitted `user_message_seq`, which the outer rejection concealed.

## Behavior

A completed Agent using PTC or mixed presentation temporarily receives direct schemas through public `tools.presentAs('native')`. Its persisted preset ID, permissions and sandbox remain unchanged. No mode is registered. Starting the next task's planning, clearing the task or confirming repair releases the override and restores the preset's presentation. Completed state hides disallowed inherited tools, preventing visible `bash`, writes or implementation controls from inviting rejected calls. Public filters exempt tools registered in the Agent’s own scope; execution guards still protect such custom compositions, and their disallowed schemas are not claimed to be hidden. Standard presentation needs no override. A required post-approval read-only turn also receives direct reads; a successful read and completed turn restore PTC. Incomplete or interrupted turns do not unlock writes.

- An ordinary inquiry can read artifacts and task state without creating a task or changing the completed one.
- An explicit new-task request first reads `task_status`, then binds `task_create` to the latest real human message sequence. Planning and independent plan review follow; initial implementation still awaits approval.
- A defect within the original objective still requires a repair proposal and a user click confirming its impact.
- Completed-task guards still reject writes and arbitrary executors. A program's claim to be read-only does not authorize execution. Direct file reads do not grant arbitrary shell/git commands.

Agent lifecycle and durable task-state events synchronize the override before the first model request is assembled. Restart reconstructs it from the current projection; cleanup affects only that Agent. History and other Agents' presentations are unchanged.

## Validation

The owning controller suite passed 113 tests; one existing Docker test was skipped. New regressions cover first-request schemas, read-only inquiry, real human sequence binding, PTC restoration for the next task, restart, clearing a required post-approval read-only turn and unrelated Agents. Existing completion-write protection and repair-confirmation regressions also pass. Host/Client strict type checks, build and packed-entry checks pass.

[Machine evidence](completed-ptc-controls-checks.json) records real-model validation. This is a tool-admission regression, not a long-horizon benchmark or an increase in independent reviewer execution capability.

## Retained separate failure

After the read-only entry fix, the first real-model case submitted stage review under the default 120-second `run_code` budget. The program ended before review settled and cancelled it. The durable job records `cancelled`, `retryable: false`; `/task retry-review` rejected retry, while ordinary resume required resolving the review fault first. This differs from completed-task admission. This change does not modify review-job lifetime or the native PTC budget.

One completion inquiry successfully read state and the file, but additionally attempted a hash check with still-visible `bash`, causing one denial. That record is retained; inherited-tool filtering was then added and the inquiry repeated after restart.

The subsequent case explicitly uses native-supported `timeoutMs: 600000` for review calls, without changing Host, profile, model route, inputs or acceptance criteria. A success proves the target flow under that budget; the default-budget interruption is not a pass. Follow-up work must coordinate durable reviews with the outer program budget and distinguish human cancellation from outer timeouts, with the appropriate recovery action.

[简体中文](completed-ptc-controls.zh.md)
