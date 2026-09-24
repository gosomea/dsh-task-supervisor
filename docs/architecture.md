# Architecture proposal

**Status: design proposal.** The project has no runnable plugin yet. This document owns the proposed task lifecycle and component responsibilities. [Review policy](review-policy.md) owns intervention behavior; [evaluation](evaluation.md) owns comparative claims.

## Summary

One DSH session holds the user's request, subsequent instructions, agent actions, and tool results. The supervisor maintains durable task state for that session and decides when to continue, pause, or finish. The main agent executes work; independent reviewers inspect recorded evidence.

## Task ownership

| Actor | Responsibility |
| --- | --- |
| User | Sets the objective and constraints, confirms the initial autonomous plan once, and resolves explicit pauses. |
| Main agent | Proposes and updates the plan, works in the bound session, records results, and requests completion. |
| Supervisor controller | Owns durable task state, versions the effective plan, admits rounds, applies review decisions, and decides the task's terminal state. |
| Round reviewer | Runs independently at each checkpoint by default and returns evidence-linked findings and a recommended next action. |
| Specialist reviewer | Runs only when a specific finding requires a focused review. |
| Final evaluator | Independently checks the completion claim against session evidence and workspace results; acceptance checks run in an isolated copy. |

The controller makes deterministic state transitions. Model reviewers supply findings and judgments; they do not directly mutate the main workspace or control state. The default topology combines persistent task state with a fresh reviewer at each checkpoint. A continuous reviewer session remains a configurable alternative.

## Shared evidence and state

The bound main-session log is the source of truth for user instructions and observed execution. A new user instruction in that session takes effect through the normal task-state update path; the user does not have to approve an artificial synchronization between the agent and reviewer. The plugin records its own durable events for task interpretation, plan versions, review findings, user decisions, continuation, and final disposition. A replayable projection reconstructs controller state after restart; process memory is never its sole record.

The reviewer starts at the last completed round, pages backward when context is missing, and then follows an incremental event cursor. Its read tool is bound to the main session and cannot select an arbitrary session ID. It returns structured boundaries and event IDs; longer message bodies and tool inputs or outputs require explicit expansion and redaction. A finding cites the event IDs that support it. [Review policy](review-policy.md) owns the access and intervention rules.

## Lifecycle

```text
User request
  → task interpretation and initial plan
  → one user confirmation before autonomous multi-round work
  → one execution round
  → light pre-action checks and independent round review
  → continue, revise plan, or pause for a user decision
  → milestone review as needed
  → main agent requests completion
  → independent final evaluation
  → complete, continue, or await the user
```

The controller selects a single-round path for a short task or autonomous continuation for a longer task and may change that choice as evidence develops. It can start the next round while work remains. A completion request is a proposal until final evaluation accepts it. Confirmed stagnation pauses for the user. A host restart restores state but leaves execution paused until the user manually resumes; it must not silently start a new round.

## DSH integration direction

The intended implementation uses DSH plugin registrations and effect cleanup, durable session events and projections, agent lifecycle hooks, and native client extension points. A target DSH profile replaces native Goal and Plan control for the bound task, so two round drivers do not compete. The existing [Goal package](../../../deepseek-harness/packages/goal/README.md), [Plan mode](../../../deepseek-harness/packages/plan/plan-mode/README.md), and [DSH architecture](../../../deepseek-harness/docs/architecture.md) are implementation references, not behavior inherited by default. The [Jev verifier prototype](../../dsh-jev-verifier/README.md) can provide selected parsing, repeated-action detection, structured review, and UI ideas; its in-memory state and fixed three-reviewer cadence do not define this design.

## Dev Note

Open implementation decisions: exact DSH event types and projection schema; typed plan-update surface; round admission, cancellation, and fork semantics; command and client names; approval transport; safe active-session reads during concurrent append; and migration from any existing Goal or Plan state. Resolve these against the current DSH source and isolated tests before describing them as implemented behavior.
