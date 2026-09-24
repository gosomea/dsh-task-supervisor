# Architecture proposal

**Status: design proposal.** The project has no runnable plugin yet. This document owns component responsibilities and integration direction. [Task lifecycle](task-lifecycle.md) owns task state and controls. [Review policy](review-policy.md) owns intervention behavior; [evaluation](evaluation.md) owns comparative claims.

## Summary

One DSH session holds the user's request, subsequent instructions, agent actions, and tool results. The supervisor maintains durable task state for that session and decides when to continue, pause, or finish. The main agent executes work; independent reviewers inspect recorded evidence.

## Task ownership

| Actor | Responsibility |
| --- | --- |
| User | Sets the objective and constraints, confirms the initial autonomous plan once, and resolves explicit pauses. |
| Main agent | Proposes and updates the plan, works in the bound session, records results, and requests completion. |
| Supervisor controller | Owns durable task state, versions the effective plan, admits rounds, applies review decisions, and decides the task's terminal state. |
| Checkpoint reviewer | Runs independently at each checkpoint by default and returns evidence-linked findings and a recommended next action. |
| Specialist reviewer | Runs only when a specific finding requires a focused review. |
| Final evaluator | Independently checks the completion claim against session evidence and workspace results; acceptance checks run in an isolated copy. |

The [Supervisor Session module](session-runtime.md) owns durable records, replay, recovery, and evidence references. It reuses native Session logs and joins reviewer sessions into an audit view. Model selection reuses DSH profile configuration; [reviewer model policy](review-model.md) owns the details.

The controller makes deterministic state transitions. Model reviewers supply findings and judgments; they do not directly mutate the main workspace or control state. The default topology combines persistent task state with a fresh reviewer at each checkpoint. A continuous reviewer session remains a configurable alternative.

## Relationship to Agent Team

The main agent remains the task executor. Supervisor is a deterministic task controller assisted by independent model review; it does not introduce a general-purpose Lead that delegates the whole task to a Worker. Team already offers durable collaboration, and a well-instructed Lead can review and correct work. Supervisor must demonstrate value through enforced checkpoints, independent completion authority, and consistent recovery. See [first prototype and Team comparison](prototype.md) for the exact boundary and competing baseline.

## User entry

Supervisor uses an independent command namespace, provisionally `/task`. Creating a task and beginning with planning lead into one task lifecycle. The plugin offers an alternative to Goal and Plan for planning, persistent objectives, continuation, and completion judgment; native commands remain owned by their original plugins. Entry choice does not fix task duration, and the controller may select single-round or autonomous multi-round execution from task evidence.

| Command | Proposed supervisor behavior |
| --- | --- |
| `/task new <objective>` | Create the task and propose an initial plan; obtain the one user confirmation before autonomous multi-round execution. |
| `/task` | Show the task list, selected task, review findings, and next available action in Supervisor. |
| `/task edit <objective>` | Update the selected task objective and record a new effective version; the main agent revises its plan using the same session evidence. |
| `/task pause` | Stop automatic continuation while preserving task state. |
| `/task resume` | Explicitly resume a paused task, including after a host restart. |
| `/task clear` | End the current task and preserve its durable history. |
| `/task plan [request]` | Create a draft with a request, or open the selected task for planning without one; approved work uses the same execution lifecycle. |
| `/task plan off` | Exit planning without treating an unapproved draft as permission to execute. |
| `/task off` | Close Supervisor, retain task state, and stop its execution and review. |
| `/task on` | Enable Supervisor; tasks still require explicit resume. |

Commands and right-panel controls enter the same supervisor request path. The bounded list, selected task, JSON snapshot, close button, and command recovery rules are defined in [task lifecycle](task-lifecycle.md). A later user instruction or `/task edit` is not an artificial second synchronization approval; the main agent and reviewer see the same session record. A new explicit user decision is required only when the review policy pauses for one or another host approval applies.

## Shared evidence and state

The bound main-session log is the source of truth for user instructions and observed execution. A new user instruction in that session takes effect through the normal task-state update path; the user does not have to approve an artificial synchronization between the agent and reviewer. The plugin records its own durable events for task interpretation, plan versions, review findings, user decisions, continuation, and final disposition. A replayable projection reconstructs controller state after restart; process memory is never its sole record.

The reviewer starts at the last completed round, pages backward when context is missing, and then follows an incremental event cursor. Its read tool is bound to the main session and cannot select an arbitrary session ID. It returns structured boundaries and event IDs; longer message bodies and tool inputs or outputs require explicit expansion and redaction. A finding cites the event IDs that support it. [Review policy](review-policy.md) owns the access and intervention rules.

## Lifecycle

```text
User request
  → task interpretation and initial plan
  → one user confirmation before autonomous multi-round work
  → one execution round
  → check whether a stage review or progress watchdog is due
  → continue within the stage, revise plan, or pause for a user decision
  → independent review before advancing a completed stage
  → main agent requests completion
  → independent final evaluation
  → complete, continue, or await the user
```

The controller selects a single-round path for a short task or autonomous continuation for a longer task and may change that choice as evidence develops. It can start the next round while work remains. A completion request is a proposal until final evaluation accepts it. Confirmed stagnation pauses for the user. A host restart restores state but leaves execution paused until the user manually resumes; it must not silently start a new round.

## DSH integration direction

Implementation uses DSH's general plugin registrations and effect cleanup, durable session events and projections, agent lifecycle hooks, and client extension points. Supervisor owns its commands, model tools, state service, projection, continuation driver, and right-hand panel. Installation does not override `/goal` or `/plan`, take over native `get_goal`, `create_goal`, `update_goal`, or `exit_plan_mode`, require Goal or Plan to be uninstalled, or read and write their private state. Exact model-tool names and schemas remain open; the main agent's completion operation can only request acceptance.

One DSH installation can offer both native workflows and Supervisor. The initial supported path uses a dedicated agent preset and a fresh supervised session. That preset composes general execution tools with Supervisor's own task tools, preventing the main agent from starting another task controller within a supervised round. Two controllers continuing the same session is unsupported. Users stop native continuation themselves before switching or start a separate supervised session; the plugin does not automatically take over old tasks. Tool visibility and preset admission need isolated-host validation; distinct command names alone do not establish safe mixed execution.

Closing Supervisor stops only its owned work and does not automatically start native Goal or Plan. Host dependencies are general DSH capabilities; Goal and Plan are behavior and source references, not required supervisor services. Composition, model-tool visibility, and client loading must demonstrate both that native plugins remain independently usable and that Supervisor runs without native Goal and Plan services mounted. See [DSH architecture](../../../deepseek-harness/docs/architecture.md); the [Jev verifier prototype](../../dsh-jev-verifier/README.md) supplies selectively reusable lessons.

## Dev Note

Open implementation decisions: exact DSH event types and projection schema; typed plan-update surface; host mappings for the specified admission, cancellation, and fork behavior; independent command naming and attachment handling; client rendering; approval transport; safe active-session reads during concurrent append; and dedicated preset composition and tool visibility. Resolve these against the current DSH source and isolated tests before describing them as implemented behavior.
