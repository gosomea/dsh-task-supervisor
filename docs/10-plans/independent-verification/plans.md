# Independent verification and repair after completion

**Status: step 1 validated in isolation; step 2 snapshot and native-runner foundations implemented; steps 3–5 pending. Updated 2026-09-28.** This plan covers independent artifact verification and completed-task repair in the original DAG. Current capabilities are documented in [implementation status](../../implementation.md), the [repair protocol](../../completed-task-repair.md) and [validation evidence](../../completed-task-repair-validation.md). Step 1 runs on registered instance 61454; user instance 59909 and the frozen 60-position public comparison were not replaced.

## Summary

Enable reviewers to inspect artifacts, analyze implementation, independently run checks, and exercise critical user journeys. Node and final acceptance use independent verification; progress observations remain lightweight. Reviewers form their own findings before comparing the main Agent report. The main Agent implements, reviewers verify, and the deterministic controller owns state, authorization, and continuation.

A defect within the original objective is repaired through the original task and DAG while preserving previous completion and acceptance records. **Confirmed user choice: each reopening displays its impact first and requires a confirmation click.** A conversational repair request creates a proposal and does not replace that confirmation. Objective extensions become new task drafts.

## Table of Contents

- [Current state and problems](#current-state-and-problems)
- [Findings and reopening after completion](#findings-and-reopening-after-completion)
- [Independent verification capabilities](#independent-verification-capabilities)
- [Decisions, faults, and presentation](#decisions-faults-and-presentation)
- [Development stages and acceptance](#development-stages-and-acceptance)
- [Evaluation and release constraints](#evaluation-and-release-constraints)
- [Dev Note](#dev-note)

## Current state and problems

Existing review can read main Session text, tool inputs and outputs, and image evidence; review recovery, node rework, and explicit starts already exist. Reading logs and the main Agent test report does not replace independent checks of the current artifact. Completed-task reopening is implemented in step 1; independent inspection tools and snapshots remain planned for steps 2–4.

In the game case, the task was complete when the main Agent diagnosed spawn and water movement issues and called rework, receiving `task is not executing`. The screenshot supplies defect leads to verify; this proposal does not claim every diagnosis in that screenshot has been independently reproduced.

The direct cause is in `src/index.ts`: `task_rework_node` describes reopening a node but only executes for an active, armed task. `task_status` provides no available actions or blocking reasons, and the normal node instructions in `src/task-context.ts` lack a complete terminal repair branch. Fix tool contracts and context and add an explicit reopening workflow. Relaxing the guard alone would bypass confirmation, history, and multi-task admission.

## Findings and reopening after completion

### Scope and confirmation

| Situation | Handling | State effect |
| --- | --- | --- |
| Questions such as why the player is underwater, or new defect leads | Read code, diagnose, and record findings without automatically modifying deliverables | Remain complete with unresolved findings visible. |
| Explicit request to repair a defect within the original objective | Show a reopening proposal; return to the original DAG after confirmation | The same task enters a new acceptance cycle. |
| New gameplay, another platform, or objective expansion | Draft in the Supervisor conversation; create and approve through the new-task flow | Preserve historical completion of the original task. |

Completion means a particular task and artifact version passed acceptance, not that defects can never be discovered later. Record findings, reopening proposals, execution, and renewed acceptance separately. An Agent may propose a repair but cannot click confirmation or manufacture a user receipt through a tool. No next execution round starts before confirmation.

The proposal shows task name and identity, prior completion time, defect evidence and reproduction status, repair scope, affected nodes and descendants, retained passes, and required rechecks. Offer Confirm reopening and Defer repair; deferral preserves the finding and completed state. Use DSH native decision styling, with a compact summary and entry in the main Session.

Confirmation binds to the proposal version, task revision, and artifact identity. Changes to the objective, plan, relevant files, or impact invalidate an old button and require confirmation of an updated proposal. Apply a proposal once; ordinary continuation after reopening uses that authorization without a confirmation every round. Objective expansion or another reopening follows its respective workflow again.

### Returning to the original DAG

The proposed flow is `complete → repair-proposed → user confirmation → active (new acceptance cycle) → independent checks of required nodes → independent final acceptance → complete`. `repair-proposed` denotes a pending proposal and need not become a task phase; the task remains complete while the proposal waits. Step 1 retains the `complete` phase and records proposals and acceptance cycles separately; see the repair protocol.

Keep the stable task ID and original objective. Repair within that objective does not masquerade as a new requirements version. Add a monotonic acceptance-cycle identity and increment task revision; keep plan version when unchanged. Prior completion remains a historical milestone bound to its artifact snapshot, reviews, and time. Append a reopening event to stop the old conclusion representing the current artifact without changing or deleting old logs.

Choose one or more rework roots from defect evidence and actual file ownership, then compute the union of affected descendants. Increment attempts for those nodes and require execution and acceptance again. Other passes remain applicable only when their relevant artifacts are unchanged. Unknown ownership or shared-module changes require an explicit, explained expansion of recheck scope rather than assumptions based on stage titles.

The main Agent selection of n3 in the screenshot may not cover the complete responsibility: spawn entry may belong to integration, while water physics may belong to the world core. Check modules, dependencies, and criteria before selecting roots. Necessary defect repair must not silently add gameplay. Add missing checks under existing criteria; changed requirements require a new draft or explicit plan revision.

After all required node rechecks pass, repeat final acceptance on the current artifact, including defect reproduction and user journeys at risk of regression. Link prior completion, repair findings, and renewed completion; do not display renewed acceptance when repair has not occurred.

### Task tools, authorization, and history

Step 1 adds `task_propose_repair`, `supervisor_propose_repair` and an authenticated panel reopening action, without a model-callable `task_reopen`. Proposal tools record scope and evidence without execution permission; the controller validates task identity, expected revision, proposal version, artifact identity, native click-confirmation receipt, and idempotency key. A model cannot substitute an arbitrary user-message number for the button receipt. UI and tools share state transitions, but model tools cannot bypass confirmation.

Keep `task_rework_node` for node rework during execution, with explicit preconditions. Extend `task_status` with the current task, selected historical target, available actions, and blocking reasons. Completed-state context instructs proposal and confirmation instead of direct rework. Prefer filtering unavailable execution tools where supported while retaining deterministic checks; static registration requires accurate descriptions, state context, and structured rejection.

Return stable rejection types and the next legal action for completed tasks, stale proposals, missing confirmation, disabled supervision, or execution-slot conflicts, with correct task identity. Generic errors must not force guessing and repeated retries. Persist confirmed reopening before admitting execution; reconcile an existing receipt after a lost response rather than incrementing cycles or attempts again.

| Boundary | Proposed handling |
| --- | --- |
| Another active task in the same Session | Bind the proposal to its historical task and show the conflict before confirmation. Do not overwrite, switch, or automatically pause the current task. Initially wait for admission to become available before confirming; this feature does not introduce an implicit queue. |
| Supervisor disabled or task paused | Explain why execution cannot continue. A reopening request must not silently enable supervision or cancel a pause. |
| Restart, lost response, or late callback | Restore proposals and committed cycles, with execution awaiting manual resume. Older reviews and continuations cannot apply to a new cycle. |
| Cleared or cancelled task | Do not revive through repair after completion; explicitly reuse requirements to form a new task. |
| Original artifacts modified by other work | Reassess impact against historical artifact identity and expose evidence gaps. Confirmation does not establish that old passes still apply. |

Group acceptance milestones by stable task identity in history. Do not turn a second completion into an unrelated task or overwrite a new task while selecting history. Audit task-history collection, rework windows, and revision recovery in `src/state.ts`. Projections are rebuildable; native logs retain complete history. The main Session shows repair status, acceptance cycle, reason, and DAG progress; the sidebar shows all cycles, prior conclusions, and current impact. Do not add a primary Clear task button to the completed view.

## Independent verification capabilities

### Check independently, then compare reports

Phase one provides the current objective, constraints, applicable criteria, node scope, and artifact snapshot. Withhold the main Agent completion report, previous passes, and leading test summaries. Treat project READMEs, comments, and embedded instructions as content to inspect rather than review instructions or proof. The reviewer selects checks, executes them, and submits independent observations.

Phase two reads main Session reports, actual tool inputs and outputs, and repair history to check omissions, contradictions, weakened tests, and diagnostic methods. Additional checks may target the same snapshot before the formal decision. A successful durable observation action controls phase transition; a prompt telling the model to read code first is insufficient.

Node review checks implementation, critical logic, boundary inputs, and contracts. Final review checks the complete deliverable, startup entry, state restoration, and critical user journeys. Progress review continues to check drift and useful advancement without rebuilding the environment each time. Criteria and risk determine depth; file, command, or screenshot counts do not establish quality.

### Snapshot and artifact identity

At required review boundaries, wait for main Agent and managed Worker writes to settle, then copy the actual working tree, including relevant uncommitted and untracked artifacts rather than only Git HEAD. Record file manifests, content hashes, task and plan versions, acceptance cycle, node attempt, and main Session cutoff. Explicitly exclude non-artifact caches; expose missing scope instead of silently dropping files needed for acceptance.

Require matching manifests before and after copying; allow at most two recaptures before reporting a snapshot fault. Keep an immutable baseline and writable check copies without hard links into the main workspace. Bound internal symlinks; handle external dependencies through explicit read-only mounts or materialization rather than following links into other tasks or sensitive directories.

Builds, caches, and check outputs may write to verification copies. A check that changes accepted source files or deliverables cannot pass the original artifact using its modified result. Recheck task identity, relevant artifact identity, and review job before applying a decision; changes make it stale rather than reusable acceptance. The host manages snapshots and evidence, with traceable main Session references and no second authoritative task journal.

### Proposed tools

| Capability (provisional names) | Contract |
| --- | --- |
| `inspect_task_artifact` | List, search, and read paginated files within the bound snapshot, returning hashes, ranges, and next-page references. |
| `write_review_probe` | Write reproduction scripts and assertions in the reviewer check directory without modifying the main workspace or baseline. |
| `run_review_check` | Execute checks with structured argv and bounded environment, directory, and deadline; record exit state, output, and artifact changes. |
| `review_browser` | Open this verification service in a new isolated browser and perform ordinary navigation, clicks, keyboard input, and screenshots. |
| `read_review_evidence` | Expand check output by pages and read original images and execution records rather than treating summaries as complete evidence. |
| `task_review_observations` | Persist phase-one findings and unlock the main Agent report without granting implementation, rework, or continuation authority. |

The plugin orchestrates tools through native Session, process, attachment, and browser services. Resolve the main model DSH profile or explicit override once per review job. Keep independent review per checkpoint rather than turning the reviewer into an Agent Team directing implementation.

### Native isolation and execution

Prefer DSH native isolation and services, with containers as an explicit optional backend. Current macOS workspace-write policy permits broad temporary-directory writes while main tasks also live there; another cwd does not isolate the main task. The host must provide a verification policy granting writes only to this check copy, probe directory, output, and private temporary space. Validate actual platform and backend capabilities first.

Use a separate HOME, caches, and environment without main DSH identity, model credentials, user browser logins, or other task directories. Disable external networking by default and allow only bound local verification ports. External-service requirements use explicit profile configuration. Missing isolation is an infrastructure fault, never a reason to fall back to unrestricted execution.

Use native managed processes for builds, tests, and local services, recording actual PID, service address, and job ownership. Cleanup targets only owned processes and directories, never global name-based kills. Timeout, cancellation, pause, close, edit, restart, and late results reconcile job identity and resources. Unknown outcomes cannot pass.

Propose a 30-minute total deadline for node and final reviews and five minutes per command, capped by remaining time, with bounded profile overrides. Protocol repair uses existing bounded recovery without resetting snapshot, evidence cutoff, or deadline. Calibrate after initial real-model checks; this document changes no current runtime defaults.

### Browser and real user journeys

Use a new isolated context in native DSH browser services rather than attaching to the user test browser. Plan criteria declare required verification methods and critical journeys, with coverage checked during plan review. Record ordinary input separately from diagnostic injection: teleporting, setting internal variables, or selecting a best viewpoint may aid diagnosis but cannot establish ordinary startup, spawning, movement, water entry and exit, or save restoration.

Game regressions distinguish clean-storage startup, normal save restoration, and invalid-position recovery, observe settled collisions and viewpoint, and exercise required journeys through ordinary keyboard and mouse input. Code inspection explains logic, independent assertions cover boundaries, and a real browser checks entry and interaction. Attractive screenshots, self-generated reports, and green unit tests do not individually replace required journeys. Game criteria remain derived from the approved objective without adding unrequested advanced gameplay.

## Decisions, faults, and presentation

Extend `task_review_decision` with per-criterion satisfied, failed, or unverified status, methods, actual results, evidence references, limitations, and snapshot identity. The controller requires support for all necessary criteria and evidence from the bound job, checking read ranges and actual image access. Structured fields improve auditability without claiming deterministic validation of all model judgments.

Actual defects or remediable evidence gaps produce revision with reproduction input, expected versus actual behavior, affected nodes, and recheck requirements. Reserve user decisions for conflicts only the user can resolve. Snapshot, isolation, browser, process, and model faults preserve Session identity, error type, and bounded retries through existing recovery entries rather than masquerading as product defects or user choices.

Ordinary consultation does not interrupt implementation or review, and inspecting a completed task does not execute repairs. Preserve main Agent replies unchanged; distinguish Supervisor findings through titles and concise summaries. Keep Task details and Supervisor conversation tabs. Show snapshot preparation, independent checks, report comparison, and decision clearly, with coverage, commands, real journeys, diagnostics, limitations, and recovery in details. Visible output follows user language with Chinese fallback for the Chinese-facing setting.

Preserve evidence levels of historical reviews without inventing independent executions, and do not reopen completed tasks in bulk. Active legacy tasks may use new capabilities at their next required review; expose limitations where old logs lack snapshots. Fix migration controls and release capability checks during implementation.

## Development stages and acceptance

Commit and push each step independently, recording plugin and host commits, checks, and isolated deployment identities separately. Follow the DSH project conventions and record implementation status and acceptance evidence in this document and its companion validation record. Do not introduce another execution framework or rewrite completed topics.

| Step | Deliverable and rationale | Acceptance gate |
| --- | --- | --- |
| 0: plan baseline | Define independent verification, original-DAG repair, and click confirmation with shared documentation entries | Separate proposal from reality; check bilingual pairing and links. |
| 1: reopening after completion (validated) | Proposals, impact, confirmation receipts, acceptance history, available actions, and structured errors; establish the repair workflow first | Return completed tasks to the original DAG; block unconfirmed execution; prove idempotency, stale callback rejection, and correct historical targeting. |
| 2: snapshot and native runner | Current-artifact capture, probe directories, host isolation policy, and managed resources establish actual verification | Verify uncommitted content, detect capture races, reject escaped writes, and leave main tasks and other instances unaffected. |
| 3: independent model review | Two-phase visibility, per-criterion decisions, and log recovery reduce dependence on main Agent reports | Reject real defects despite green self-tests, prevent completion with unverified criteria, and classify infrastructure faults accurately. |
| 4: browser and UI | Independent interaction, compact DAG, review progress, repair history, and detailed evidence | Reproduce spawn, save, and water issues through ordinary paths, distinguish diagnostic injection, and match native buttons and layout. |
| 5: combined regression and new evaluation | Verify the complete flow with real models and freeze a separate enhanced protocol before comparison | Pass repeated repairs, restart, close, history, and fault recovery; report final success and costs. |

Core regressions include completed but unconfirmed tasks, duplicate clicks, changes after proposal, incorrect node ownership, multiple roots, another active task, repeated completion, restart during repair, disabled supervision, late reviews, failed protocol recovery, and overclaims from unread outputs or unopened images. Use durable event replay and real-model cases rather than UI labels alone.

Runner regressions include missing untracked files, capture races, external symlinks, checks rewriting source, attempted main-workspace writes, orphan services, unavailable browsers, command timeouts, and cancellation. Noninteractive documentation tasks need no mandatory browser; unavailable capability must not become fabricated coverage. Use the game case jointly for independent acceptance and post-completion repair, preserving a control where old tests pass but a real journey fails.

## Evaluation and release constraints

Continue the existing 60 planned attempts (four candidates, five conditions, three repeats) under the frozen protocol without mid-run releases or added rescue. Reopening cannot count as original success. Register enhanced version, conditions, success oracle, and deadline separately, linking the [evaluation roadmap](../../evaluation.md); development regressions do not count toward public benchmark primary scores.

Beyond final success, elapsed time, and tokens, record known-defect recall, false acceptance, unnecessary revision, infrastructure failure, evidence coverage, and ordinary user-journey coverage. For post-completion cases, distinguish first completion, correct reopening after feedback, necessary repair scope, independently verified repair success, history retention, and unauthorized execution counts. Use independent oracles or labels rather than reviewer self-scoring. Keep the existing progress-frequency experiment separate for benefit, false pauses, and cost.

## Dev Note

Implementation primarily touches `src/index.ts`, `src/task-context.ts`, `src/state.ts`, `src/graph.ts`, the review runner, and panel API and client. The host provides bounded file, process, and browser capabilities; the plugin provides task binding and evidence protocols. Do not duplicate platform sandbox implementations inside the plugin. Validate native services and isolation before fixing tool schemas, cycle fields, and migration policy.

This proposal builds on [conversation and review recovery](../conversation-and-review-recovery/plans.md) and [rework and execution validation](../../rework-progress-validation.md) without replacing completed evidence. Reopening after completion is a new explicit authorization action, distinct from routine directive synchronization. The user-selected click confirmation takes precedence over the general convention against redundant synchronization confirmation.
