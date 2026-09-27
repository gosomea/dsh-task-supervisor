---
title: "Supervisor interaction and long-horizon review proposal"
description: "Use the shrine Session to design language, task graphs, user decisions, consultation, and progress review."
status: "in-progress"
date: "2026-09-27"
---

# Supervisor interaction and long-horizon review proposal

## Summary

This proposal uses the shrine run to refine interaction and control. Users should see work, reviews, and pending decisions in the main Session, while the supervisor can detect drift during long turns. Batch one is implemented and validated with two real-model tasks; batches two and three remain designs. See [implementation status](implementation.md). Retain authoritative main Session records, one continuation controller, and independent read-only reviews; add persistent consultation and actual task dependencies.

## Table of contents

- [Run inspection](#run-inspection)
- [Language and continuation](#language-and-continuation)
- [Conversation and sidebar](#conversation-and-sidebar)
- [Task graph and parallelism](#task-graph-and-parallelism)
- [User decisions](#user-decisions)
- [Persistent consultation](#persistent-consultation)
- [Reviews and evidence](#reviews-and-evidence)
- [Delivery and acceptance](#delivery-and-acceptance)
- [Dev Note](#dev-note)

## Run inspection

The durable log of main Session `f0a588dd-ea37-4be3-82e6-a87a2641a2af` was read through seq 2793 at 14:50:54 on 2026-09-27, Asia/Shanghai. S9 had passed, S10 was active, phase was `active`, revision was 31, and no final completion decision existed. The [earlier diagnosis](postmortem/2026-09-27-shrine-session-diagnosis.zh.md) stopped at 14:37; its S9 status is consistent with this later observation. This document does not track subsequent results.

| Observation | Finding and consequence |
| --- | --- |
| Ten ordered stages | `state.ts` has `stages` and `stageIndex`, without dependency edges or per-node state; this is not a general DAG. |
| Chinese objective, English reports | Planning, continuation, and review instructions are English without an explicit response-language policy. This is an addressable influence, not proof of a sole cause. |
| Typed approval did not apply | Seq 94 is the user approval text, followed by executor refusals; command approval admitted execution at seq 120. |
| `detail` schema error | The strict stage schema accepts only `id/title/criterionIds`. A retry recovered, but detailed plans lack a suitable field. |
| No checkpoint within a long turn | The S8 interval lasted about 47 minutes with 121 calls in one turn; progress review only triggers on idle by turn count. |
| Insufficient independent visual acceptance | Review tools expose truncated text and call arguments, not images. Main Agent image inspection is not reviewer image inspection. |
| Old fixtures entered scope | C13 includes CSV, `verify.mjs`, and `report.json`; workspace leftovers entered the plan before approval and passed review. |
| Continuations lack progress summaries | Seq 163 through 2716 repeat about 1,700 characters of objective and stage ID without accepted work, issues, and next steps; main Session history still exists. |
| Current and historical status are unclear | The sidebar shows the current stage and latest review; conversation cards show historical turn-tail results. Resume is offered for `reviewing`, without distinguishing active and interrupted review. |

Automatic advancement ran, but this does not establish continuous correction, visual quality, or superiority over Goal/Plan/Team. Prepare clean new test workspaces while preserving the running shrine workspace as evidence.

## Language and continuation

Persist task `responseLanguage` with auto and explicit modes. Suggested precedence is explicit user language, explicit profile response language, auto detection from task-creation prose, then profile fallback (Simplified Chinese here). Update on an explicit language switch, not English code, quotations, tool results, or supervisor input. Apply it to planning, reports, reviews, consultation, and continuation; restore it after compaction. Manage UI locale separately and preserve paths and protocol enums.

VS Code provides `github.copilot.chat.localeOverride`, defaulting to auto, for response language; GitHub Copilot personal instructions support persistent language preferences. Use automatic selection, explicit overrides, and persistent injection, while testing compliance. User-visible explanations should follow the selected language; raw reasoning depends on model support and internal reasoning language cannot be guaranteed. [VS Code settings](https://code.visualstudio.com/docs/agents/reference/ai-settings), [GitHub personal instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-personal-instructions).

Build bounded continuation context from authoritative state and reports: objective/plan versions, node title, accepted work, recent findings, open issues, next action, scope constraints, artifact references, and evidence cutoff. Provide pageable overflow instead of silently truncating hard constraints. Distinguish execution claims from accepted work. Persist through the native inbox and show an expandable summary.

## Conversation and sidebar

Place one current-task disclosure in the main Session with task name, plan version, accepted node count, running/reviewing/waiting nodes, and last activity time. Expand for the DAG, details, and actions. Hover provides a summary; clicking or keyboard input opens stable details without requiring hover on touch. Node counts are not effort percentages. Attribute historical submissions, reviews, and user/control outcomes clearly; history does not impersonate current state.

Share one versioned projection and action service across the conversation and sidebar, preferably using native event subscriptions, refreshed snapshots after reconnect, and stale-response rejection. Sidebar order is current status/decisions, all nodes, selected-node details, review history, and consultation. Collapse long objectives and keep common actions visible. Active review shows subject, duration, and pause; reserve resume for interrupted or recovery states. Host capabilities determine available actions.

## Task graph and parallelism

Add node `description`, `dependsOn`, acceptance references, and provenance. Execution records hold status, attempt identity, execution Session, times, and evidence/review links. Validate IDs, dependencies, acyclicity, and coverage. Migrate linear plans to adjacent dependency chains without invented parallelism or rewritten logs. Distinguish dependency-waiting, ready, running, reviewing, passed, needs-revision, awaiting-user, failed, and cancelled. Execution enters review before dependencies are released. Rework creates a new attempt, not a graph cycle. Upstream changes invalidate affected downstream acceptance and cancel or reconcile in-flight work.

A candidate shrine graph establishes shared interfaces, then branches into scene/terrain, buildings/facilities, and character assets. Environment motion depends on scene components; character behavior depends on terrain, character, and leaf interfaces; integration, visual acceptance, and delivery join the branches. This is replanning, not automatic DAG recovery. Implement dependencies and state with conservative serial dispatch first, then native delegation by the main Agent. Validate node/attempt identity and concurrency limits, assign module ownership, serialize conflicting writes, and use worktrees when needed. Integrate and revalidate child artifacts before completion; retain one continuation controller.

## User decisions

Persist decisions with `decisionId`, task/plan versions, node, reason, options, origin, and outcome. Human-dependent nodes wait indefinitely without model loops; show explicit timeout policies and never auto-approve without one. Initially pause the whole task; later permit explicit branch-only blocking. Restart still requires manual execution recovery. LangGraph checkpoint, interrupt, and resume semantics provide a reference while DSH retains native persistence. [LangGraph Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts).

Buttons, commands, and natural approval use one action entry. A model tool forwards the pending item and real user-message reference; the Host checks trusted origin, scope, and version rather than trusting model claims, quotations, or supervisor prompts as authorization. Unambiguous approval applies once without another click; multiple items or changed versions require a specific choice. Persist before admitting execution, deduplicate actionId, and invalidate old approvals, reviews, and continuations after edits, closure, or new control versions.

## Persistent consultation

Provide a task-bound native Supervisor conversation with persistent messages, its own model route, and native compaction. Each independent review still gets a fresh Session. Consultation explains state and relays user decisions; reviewers judge fixed evidence. Use one UI entry with review navigation, without automatically injecting consultation opinions into reviewers. Read task facts from the main log.

Default queries read snapshots and evidence with cutoffs and observation times, without messaging the main Agent, cancelling reviews, or changing admission. Explicit pause, recheck, or requirement edits use control tools with received/applied/failed receipts. A mode selector assists intent while explicit text also works. Consultation stores questions and action references; the main Session owns outcomes. Use actionId deduplication and queryable receipts rather than assumed cross-log atomic writes. Settle intervention at safe boundaries, reconcile unknown effects, and invalidate stale reviews after revisions.

Reuse DSH compaction without making task state depend on summaries. Restore task binding, language, control version, pending decisions, and read cursors, then retrieve history as needed. Inherit the effective profile model with profile-scoped overrides. Fork establishes a new binding without control over the original. Distinguish clearing conversation, recreating an Agent, and closing a task. Validate native slot, compaction, recovery, and model contracts before integration; do not create another session log system.

## Reviews and evidence

Retain plan, node, and completion reviews; add observations triggered by time, tool activity, or repeated failure at safe step boundaries over fixed log prefixes. Duration triggers inspection, not a drift verdict. Productive work continues; corrections and user decisions apply after controller version checks. Limit concurrent observations and coalesce triggers without another continuation loop.

Separate user requirements, applicable project constraints, implementation choices, and optional enhancements with provenance. Check omissions and unsupported additions so read-only turns, frame counts, and offline dependencies do not silently become user requirements; revise approved content by version. Add truncation markers, offset pagination, and adjacent events for results; current 700/1,500/3,000-character limits cannot replace full evidence. Native attachments provide versioned and timestamped read-only visual artifacts; animation needs multiple times or video plus measurements. Missing necessary evidence means unable to verify, not passing based on filenames or execution claims.

Present localized summaries as verdict, inspected items, issues/uncertainties, and next action with expandable evidence. Focus each node review on its criteria and cite established ordering checks instead of repeatedly discussing unrelated restrictions. Final review covers global requirements and integrated artifacts.

## Delivery and acceptance

| Order | Deliverable | Required validation |
| --- | --- | --- |
| 1 | Language, continuation summary, unified decisions, inline task block and sidebar | Chinese reports despite mixed code; typed approval applies once; stale approval fails; controls work without sidebar; active review is not shown as recovery. |
| 2 | Provenance, long-turn observation, original and visual evidence | Inspect long single turns without false pauses; reject unrelated fixture scope; unseen images are not claimed verified; stale callbacks cannot restart disabled tasks. |
| 3 | DAG, persistent consultation, controlled parallelism | Validate cycles and rework invalidation; execute two non-conflicting nodes with integration review; queries do not interrupt; version-bound intervention; recover consultation after compaction/restart while execution waits for manual recovery. |

Validate controls and interaction on small tasks, then rerun shrine-like work in clean directories while retaining this Session for regression. Add omission, scope expansion, human waiting, long-turn stagnation, stale review, and missing visual evidence cases. Follow the [evaluation protocol](evaluation.md) across Goal, Plan, Supervisor, and explicitly reviewing Teams with equal models, tasks, tools, and environments. Report success, false completion, drift duration, human intervention, latency, and usage separately.

### Batch one: understandable and controllable tasks

**Why first:** Typed approval did not reach the controller, Chinese tasks produced English reports, status was hidden in the sidebar, and continuations repeated the objective. Establish reliable intent, actions, and feedback before adding DAG interaction.

**Deliverables:** Durable response language and shared prompts; continuation summaries with current stage, accepted nodes, recent review, and next action; approval bound to task/plan versions and user origin; one live inline task disclosure sharing state/actions with the sidebar; stage details and historical reviews. Preserve distinct execution and review identities.

**Acceptance:** Mixed Chinese/code tasks receive a Chinese response policy; language survives restart; natural approval binds the current plan and rejects stale, quoted, or injected authorization; duplicate actions do not advance twice; inline approve/pause works without the sidebar; active review offers pause rather than resume. Reuse real Host regressions, then verify in a clean isolated environment with the daily model.

**Commit boundaries:** Language/context, control protocol, and Web interaction may be separate verifiable commits. Push each after its checks pass; do not carry failed changes into the next batch.

### Batch two: observe long turns and verify actual artifacts

**Why:** One turn with 121 calls bypassed progress review; textual logs cannot independently verify visual artifacts; old fixtures and implementation preferences became acceptance requirements. Continuous observation and readable evidence are needed for long-horizon correction.

**Deliverables:** Requirement provenance and scope checks; time/activity observations at safe step boundaries with trigger coalescing; pageable original calls/results with truncation markers; version-bound read-only visual evidence; distinct pass, revise, and insufficient-evidence outcomes. Retain one continuation controller and stale-review invalidation.

**Acceptance:** A long single turn triggers observation; productive work is not failed merely for duration; disabled/edited tasks reject old observations; truncated logs remain retrievable; missing required images cannot pass visual acceptance; a clean shrine task excludes CSV criteria. Use controlled clocks and explicit settlement barriers in asynchronous tests.

**Commit boundaries:** Provenance/evidence reads, long-turn observation, and visual review are independently verified and pushed. Record actual review capability separately from unverified model judgment quality.

### Batch three: dependencies, persistent consultation, and controlled parallelism

**Why:** A linear stageIndex cannot express independent branches; fresh reviews do not provide continuous conversation; concurrent file writes risk conflicts and false completion. Establish node identity/dependencies, then non-interrupting consultation, then execution concurrency.

**Deliverables:** A real DAG with legacy linear-record compatibility; node attempts, dependency release, and rework invalidation; a live inline DAG with node details; native persistent consultation with compaction/recovery and query/intervention tools; native delegation by the main Agent, concurrency limits, resource ownership, and integration review. A graph UI alone is not parallel execution.

**Acceptance:** Reject cycles and missing dependencies; recover old Sessions; invalidate affected successors on rework; run two non-conflicting branches concurrently and review integration; queries do not cancel execution/review, while interventions have receipts; restore binding after compaction; no automatic execution after restart; indefinite human waiting by default.

**Commit boundaries:** DAG state/scheduling, graph UI, persistent consultation, and parallel delegation each become verified, pushed commits. Finish with an isolated real task covering the integrated behavior of all batches.

## Dev Note

The initial inspection only decompressed existing logs and read source and public documentation. It did not intervene in the shrine task, rerun its tests, or modify active artifacts. Source evidence is in `src/state.ts`, `src/index.ts`, `src/reviewer.ts`, `src/client/index.tsx`, and `src/client/milestones.ts`. Batch-one implementation and isolated verification are recorded in [the validation report](v2-batch1-validation.md); later-batch fields and interactions remain proposals.

[简体中文](supervisor-experience-v2.zh.md)
