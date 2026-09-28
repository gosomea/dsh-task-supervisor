# Supervisor conversation and review recovery plan

**Status: proposal, not implemented. Updated: 2026-09-28.** This document plans draft conversations, review fault recovery, and review frequency experiments. [Implementation status](../../implementation.md) owns working behavior; this pass changes no runtime code, deployment, or frozen evaluation result.

## Summary

Merge task creation into a Supervisor conversation that persists across the main Session. Users can discuss ideas, refine requirements, or directly create a clear task. Creation passes confirmed requirements to the main Agent for planning; initial autonomous execution still requires plan approval. Review protocol faults receive one bounded repair opportunity before a visible fault and recovery entry; actual user decisions remain separate.

## Table of Contents

- [Current state and evidence](#current-state-and-evidence)
- [Forming tasks through conversation](#forming-tasks-through-conversation)
- [Four review repairs](#four-review-repairs)
- [Implementation order and acceptance](#implementation-order-and-acceptance)
- [Evaluation and release conditions](#evaluation-and-release-conditions)
- [Dev Note](#dev-note)

## Current state and evidence

Task history currently contains a separate creation form; `consultation.open` requires a current task, and consultation binds to one task, preventing its old conversation from controlling a replacement. There is no complete entry for discussion before creation. Existing native Sessions, read-only evidence tools, and user directive receipts can be extended while reusing the native composer and compaction. Owners are `src/consultation.ts`, `src/panel-api.ts`, and `src/client/index.tsx`.

In the [frozen NodeBB evaluation](../../../eval/swebench-pro-v2/frozen-nodebb-20260928.zh.md), the reviewer gave a textual conclusion without successfully recording `task_review_decision`, causing a pause around 1,761 seconds. The paused patch passed external tests, but execution did not finish within 3,000 seconds and remains a primary failure. This supports protocol recovery and fault classification; textual conclusions or diagnostic patch scores cannot count as completion.

The [frozen Navidrome evaluation](../../../eval/swebench-pro-v2/frozen-navidrome-20260928.zh.md) finished on time with seven reviews, including two progress observations. It demonstrates review cost without proving those observations unnecessary. Current code defaults trigger progress observation at safe step boundaries after 24 tool results, 300,000 milliseconds, or three consecutive tool errors; elapsed time alone does not trigger without new tool results. The policy document's three turns or twenty results was an earlier proposal. The experiment uses actual code as its baseline without declaring its frequency optimal.

## Forming tasks through conversation

### Entry and choices

Keep the Task details and Supervisor conversation tabs. Default to conversation when no task exists; Discuss a new task in history opens the same entry, replacing the separate large textarea. Keep the native composer at the bottom and display the discussion subject at the top; history retains read-only details.

| User intent | Proposed interaction | Effect on the main task |
| --- | --- | --- |
| Discuss first | Enter a broad idea; Supervisor asks the one or two questions that most affect scope and proposes a starting point | Persist discussion without creating a task or starting the main Agent. |
| Refine requirements | Explicitly request task requirements or prompt refinement and receive an editable draft | Persist a draft version without execution authorization. |
| Create from draft | Click Create task next to the draft or explicitly request creation from that draft | Persist the confirmed version's full requirements in the main Session and have the main Agent propose a plan. |
| Create directly | Send in Direct creation mode or use `/task new <full objective>` | Use the same controller; an explicit request enters planning directly. |
| Ask about progress | Read current status and evidence | Do not interrupt execution or review. |

Discussion is the default send mode, with the active mode always visible. Supervisor can suggest creation but cannot infer authorization from tone. Short replies such as okay or continue bind only to an unambiguous visible proposal; multiple candidates require a specific target. Buttons and textual actions bind the same draft version and receipt, keeping one control path.

Before a task exists, visible draft and consultation text follows the user's language, with Chinese as the configured fallback. Promotion carries that preference into the task. Language and discussion subject are separate from authorization; replying in Chinese does not make an action authorized.

For “I want to build a Minecraft,” suggest a playable voxel prototype and clarify platform, initial gameplay, and acceptance. Users can refine further or accept that starting point. The draft shows objective, scope, constraints, acceptance, and unconfirmed assumptions. Simple requests need no fixed questionnaire: ask about material choices and expose ordinary defaults for editing. After the draft is displayed, the user creates a task; the main Agent then proposes an execution plan, requiring approval before autonomous execution.

### Conversation and draft ownership

Use one persistent consultation per main Session, explicitly targeting a new task draft, the current task, or a historical task. Each model request receives the current context identity and bounded state. Old task commands cannot target a replacement merely because UI selection changes. Reviews retain independent Sessions; consultation cannot decide review outcomes or execute workspace tools.

A draft is a versioned proposal in conversation and does not occupy a created task's execution slot. Initially retain one pending draft per main Session, preserving older versions in native logs rather than building an unlimited hidden queue. Minimum draft data includes `draftId`, version, full requirements, unresolved questions, source user messages, and creation result references, with a reconstructable current draft projection. Discussion lives in the consultation Session. Promotion persists confirmed text, provenance, and receipts in the main Session, which then owns authoritative task requirements.

Users may discuss a future task during execution, but the first implementation does not create or automatically queue another task. Explain that the draft is saved and creation becomes available after the current task ends. Do not silently edit the current objective. Completion keeps conversation open without automatically promoting a draft; history selection only changes read-only details. Editing the current task requires an explicit request that invalidates old reviews and continuation.

### Creation, recovery, and migration

Bind creation to the main Session, draft identity/version, current task identity/revision, authorization source, and an idempotency key. The controller validates the draft, capacity, latest requirements, and durability barrier before recording a task with the request identity. On timeout, inspect existing tasks and receipts before retrying. Two Session writes are not an atomic transaction: the main Session creation commit is the effective point, and consultation reconciles its visible result from that commit.

Creation confirms draft requirements; initial plan approval remains the execution gate. Do not add a second confirmation for the same draft. Creation may start read-only planning but cannot bypass approval. Direct `/task new` stays available.

| Situation | Proposed handling |
| --- | --- |
| Compaction | Preserve the main binding, discussion subject, draft version, and source references; model summaries cannot recreate authorization. |
| Restart or reopen | Restore conversation, draft, and state without automatic creation or continuation; unfinished tasks require manual recovery. |
| Clear a task | Move the task to history; retain an existing draft, invalidating old approvals and commands. |
| Native context clear | Establish a new discussion boundary; old drafts require explicit reselection and old short-reply authorization cannot carry over. Validate the host event before implementation. |
| Fork | Give the new main Session its own consultation binding; explicitly copy an old draft as a new draft without controlling the parent or inheriting pending creation permission. |
| Legacy task conversation | Preserve original logs and read-only access; reference old conversations without rewriting events or turning old history into new control instructions. |

## Four review repairs

### 1. Bounded repair after protocol failure

Persist a review job identity fixing task revision, plan version, node and attempt, review kind, evidence cutoff, resolved model configuration, and reviewer Session. A normal finish without a recorded decision permits one repair turn by default. Configuration must remain finite; a total job deadline includes repair and does not reset. Select and freeze the actual default deadline from observed run distributions before implementation.

Continue the same reviewer Session with its observed evidence and tool restrictions. State that the previous turn recorded no valid decision, provide the tool, valid fields, and validation error, and request submission against the original cutoff. Do not rerun the main task, create a replacement Session, or infer pass from textual phrases. Invalid tool arguments or evidence references can consume the same repair allowance. Semantic evidence gaps should produce `revise` or `needs-user`, rather than repeated format retries seeking a pass.

Repair applies only when the absence of a valid submission is known. Classify provider faults, read failures, timeouts, and cancellation separately; uncertain outcomes require durable-record reconciliation before any retry. A successfully persisted decision survives a later turn-ending error. Application still checks job identity, version, and live state and occurs once.

Editing, pause, off, clear, new user requirements, or invalid runtime context can revoke an old job. Keep late results as history without applying them. Restart does not automatically repair; manual recovery checks identity and state. Continue the same job only if the original cutoff remains valid and the reviewer Session is resumable. Otherwise invalidate it and create a distinctly identified review, without presenting it as the same retry.

### 2. Separate faults from user decisions

| Outcome | State and display | User action |
| --- | --- | --- |
| Valid `pass` / `revise` | Apply the decision and show findings and evidence | Continue or repair work. |
| Valid `needs-user` | Await a concrete choice and explain conflict, missing information, or authorization | Answer or adjust requirements. |
| Protocol repair in progress | Retain the review gate and show Recovering review result, 1/1 | Pause or turn Supervisor off. |
| Exhausted repair or internal fault | Pause with Review fault, error class, and recovery entry | Retry review, inspect the original reviewer conversation, pause, or turn off. |
| User pause or off | Preserve the user action reason | Require explicit manual recovery. |

Initially reuse `paused` with a typed pause reason rather than expanding the state machine for each error. Decisions and faults require different record types; internal errors cannot manufacture `needs-user`. Hide inapplicable approval controls and offer Retry review with an equivalent control entry. A retry authorizes review recovery only. Existing approval, manual pause, restart, and latest instructions still determine continuation; the button cannot bypass execution gates.

### 3. Preserve failed identity and evidence

Persist the job before model execution, then record attempts, repair start, failure, valid decision, application, or stale result. Cover plan, progress, node, and completion paths rather than only one stage-report catch. UI and evaluation use the same projection. Diagnostic details expose internal fields while routine text explains the effect in the user's language.

| Field group | Minimum content |
| --- | --- |
| Job identity | `reviewJobId`, task ID/revision, plan version, checkpoint, node attempt, evidence cutoff, and runtime context identity. |
| Model and Session | Reviewer Session ID and resolved model identity; a pre-creation failure may have a null Session ID with an explicit failure location. |
| Attempt | Attempt ordinal, repair count/limit, start/end times, and trigger reason. |
| Failure | Error class, readable summary, source event references, retryability, and whether the outcome is known. |
| Success | Successful decision-tool event, supporting evidence, and application result or stale reason. |

Separate at least missing protocol, invalid decision, provider failure, evidence read failure, timeout, user cancellation, and stale job, with stable programmatic codes. Recovery receipts and effective commits must replay and deduplicate. Read old schemas without alteration. Where an old `needs-user` origin is unknown, label it Legacy record, unclassified reason rather than inferring a fault from text or rewriting history.

### 4. Progress review frequency experiment

Retain required plan, stage, material revision, and completion reviews. Progress observation catches drift when the main Agent does not report; its value depends on new evidence and actual progress. First record trigger cause, time/tool increments, covered window, review delay, decision, delivered correction, subsequent behavior change, and final external acceptance.

Deduplicate by task version, checkpoint, and evidence cutoff, coalescing progress triggers. A formal node review covers its evidence without an additional identical progress review, but progress pass cannot replace node or final acceptance. Consecutive tool errors are observation signals; legitimate exploration or a long tool call does not itself prove stagnation. Crossing a threshold cannot directly pause a task.

| Experiment arm | Purpose |
| --- | --- |
| Current code policy | 24 results / 300,000 milliseconds / three consecutive errors as a reproducible baseline. |
| Required checkpoints plus calibrated progress fallback | Select thresholds, coalescing, and cooldown from development pilots, then freeze configuration. |
| Required checkpoints only | Diagnose the incremental benefit of progress observation without assuming it should become the product default. |

All arms use the same protocol recovery and model so recovery benefit is not mistaken for frequency benefit. Annotate actual drift and legitimate exploration to measure false pauses and missed drift; an observation that passes without correction is not automatically useless. Jointly report timely external acceptance, effective correction, false pauses, missed drift, review waiting, and all-Session Token. Collect data first and change the default only after controlled comparison.

## Implementation order and acceptance

For each step, finish relevant validation, update implementation status and evidence, then commit and push separately. These are future execution gates; this documentation pass ran none of these development tests.

| Step | Rationale and scope | Acceptance gate |
| --- | --- | --- |
| A: Review records and fault classes | Fix traceability first; `state-schema.ts`, `state.ts`, `reviewer.ts`, and all `index.ts` review entries | Failures at all four checkpoint kinds retain job/Session/original cutoff; faults do not create decisions; legacy logs replay and source references open. |
| B: Bounded repair and recovery controls | Depends on A; same-Session repair, total deadline, cancellation, and recovery actions | Missing decision repairs once; repeated absence pauses as a fault; ending errors after submission, duplicates, edits/off/restart/late results cannot duplicate application or silently continue. |
| C: Main-Session consultation and draft | Extend `consultation.ts`, durable projections, receipts, and `panel-api.ts` | Discuss without a task; refinement does not create; one creation per confirmed draft version; concurrent button/text actions, stale versions, busy tasks, compaction/restart/fork cannot misroute tasks or inherit consent. |
| D: Unified entry and fault UI | Depends on A, B, C; `client/index.tsx`, `consultation.tsx`, `task-store.ts`, native primitives/styles | Explicit subjects for empty/running/complete/history views; native composer and two tabs work; main Session retains compact DAG and executor progress; correct fault/user-choice controls; native main-Agent output stays unchanged. |
| E: Observation telemetry and experiment controls | Depends on A, B; `observation.ts`, configuration, and evaluation runner | Reproducible triggers/deduplication; three policies change progress observation only; completion gates stay intact and runner reports faults/false pauses/resources. |
| F: Integrated isolated acceptance and new evaluation | Depends on all five; pin a release candidate | Real-model task and recovery tests pass; freeze a new comparison protocol with independent scores, complete denominators, and remaining issues. |

Execute A and B first to fix the confirmed continuation fault, then C and D for the user entry. E and F decide frequency from evidence without promising a specific reduction. C may be designed once A's records are fixed, but the first implementation introduces neither concurrent task queues nor general Agent Team scheduling.

## Evaluation and release conditions

Follow the registered reuse workflow in `dsh-plugin-isolated-test`: find and reuse the plugin's existing isolated deployment/profile, and create fresh TMP workspaces for independent functional cases. Do not require browser-based directory selection or alter the daily environment. Real-model tests follow the daily DSH profile model selection and record its resolved identity. Add deterministic restart, protocol failure, and legacy-format fixtures.

Conversation cases include a broad game idea, a clear read-only task, preparing the next task during execution, a second task after completion, and discussion after compaction/restart. Execution cases include plan→approval→node→completion, completion after protocol repair, manual recovery after repair exhaustion, and a genuine user-only decision. Fixtures cannot pass through textual approval, infinite retries, or hidden runner recovery.

Preserve the frozen NodeBB/Navidrome scores. Label NodeBB reruns after repair as development regressions and report versions separately. Tune frequency on development cases and compare on unused cases with frozen settings. Report protocol omission, one-repair success, fault pause, valid user decision, recovery correctness, and ending ability; separate timely task completion from external reward. Then expand public tasks according to the [evaluation roadmap](../../evaluation.md), followed by multiple Tasks/Plans/Goals in one Session.

Release requires recovery, traceability, and correct task gates; fewer review calls cannot substitute for reliability. Two paired samples cannot establish superiority over Goal/Plan or determine final frequency.

## Dev Note

This proposal owns the planned additions; the linked documents remain the long-term owners of review timing, lifecycle, and evaluation. Before implementation, validate native context-clear events, resuming a reviewer Session, durable submission versus turn-ending errors, and authorization references across native compaction. Validate required host changes only in an isolated checkout. If host support is missing, preserve failed identity and require recovery instead of presenting a new Session as the same job repair.

[简体中文](plans.zh.md)
