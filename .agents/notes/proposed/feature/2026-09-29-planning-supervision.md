# Agent Note: Planning supervision, truncation recovery and optional automatic approval

Status: proposed

English | [简体中文](2026-09-29-planning-supervision.zh.md)

## Problem

Supervisor must help a task form an executable plan. Currently, `observeStep` in `src/index.ts` observes only `active`, and idle continuation also admits only `active`; planning has neither observation nor continuation before a plan is submitted. Some plugin-started planning turns also disarm when they end. Coverage review starts with `task_submit_plan`, leaving stalls before submission unhandled.

[Analysis of the first seven evaluation positions](../../../../eval/deepswe/results-20260929-7/analysis.zh.md) records successful model requests whose final generation reached the per-request output limit. The native ending reason was `max-tokens`, and the last response contained only reasoning, without final text or tool calls. The Supervisor planning position submitted no plan and started no review. This supports adding planning continuation; it does not establish that another turn would solve the task or that independent acceptance was deficient.

The user requests sidecar continuation after truncation, observation while plans form, and an automatic execution approval option. Guidance needs progress and a concrete next output; appending only “continue” can repeat reasoning. Long model activity can also reflect productive investigation, so elapsed time and tool counts cannot independently establish drift.

## Proposal

Extend the existing single controller inside the plugin to own planning observation, truncation recovery and execution authorization. Reuse native DSH events, Sessions, inboxes and maintenance APIs: the main Agent proposes and implements plans, independent reviewers provide evidence and advice, and the controller applies state and delivers the next action. This note describes proposed behavior, not installable configuration. The frozen comparison keeps its runtime and plugin unchanged; new behavior receives a separate comparison version after isolated acceptance.

### User settings and defaults

| Setting | Suggested default | Behavior |
| --- | --- | --- |
| Continue after generation truncation | Enabled | When the current supervised task may continue planning or execution, handle real `max-tokens` with bounded, contextual continuation. |
| Observe planning progress | Enabled | Inspect requirement coverage, investigation progress and unresolved questions at supported observation boundaries; do not review every tool call. |
| Execution approval | Manual approval | Offer “execute automatically after independent plan review” and record user preauthorization for the current task. |

These settings independently control recovery, observation and authorization. Disabling existing `automaticContinuation` prevents automatic new turns, including truncation recovery. Users can disable planning observation while retaining a truncation recovery; repeated recovery without progress remains bounded. Automatic execution approval cannot clear pauses or declare task completion.

### 1. Continue after truncation

Subscribe to `session/event` for native `turn/end`, then recheck the log and queues when the Agent is truly idle. `agent/status=idle` is a time to inspect, not recovery evidence. Recovery requires the current latest turn to correspond to `max-tokens`, settled steps and tool obligations, and no pending user input or other queue items. Native `max-tokens` remains sticky within a turn, so inspect the last actual request and subsequent activity rather than overriding a later successful submission with an older truncation event.

Recovery requires matching task ID, requirements version and state revision, an enabled Supervisor and continued admission for this run, and no required review or user decision pending. `planning` may continue inspection and plan submission; execution-authorized `active` may continue the current node. `awaiting-approval`, `reviewing`, manual pause, off, complete, cleared and waiting after restart do not recover automatically. Preserve `aborted`, `error`, `interrupted` and `blocked` as separate causes rather than treating them as generation truncation.

The controller persists a recovery record and delivery message ID before using the same scheduling entry point. Bind it to task, requirements version, native turn and ending event seq; retain state revision, reason and count. Repeated callbacks reconcile this record, native messages and inbox rather than opening the same recovery again. User edits, pause or off invalidate undelivered actions. If crash recovery cannot establish delivery, wait for manual resume with the evidence instead of guessing effects. Record or flush failure prevents delivery.

The first recovery is generated deterministically without another model request just to say “continue”. Its bounded packet contains task language and original constraints, confirmed investigation or node progress, evidence seqs/readable artifact references, the specific unfinished output, execution permissions and next action. Summarize only supported facts: truncated reasoning establishes neither tool execution nor file changes, and uncertain calls must not be replayed. Mark omitted context and provide existing Session readers for detail.

Example continuation follows; actual nodes, seqs and findings must come from the current log:

> Supervisor · Continue planning: the previous generation reached its output limit without submitting a plan. Entry and configuration inspection is complete, with evidence in the events referenced by this packet; merge precedence remains unresolved. Preserve that investigation, check this question, then submit a plan with dependencies and acceptance evidence. If existing evidence suffices, submit directly rather than repeating reads. Only planning is authorized; implementation is not approved. Respond in this task’s Chinese language.

Provisionally pause after two consecutive recoveries without effective progress and wait for manual resume; the configurable threshold needs real-task calibration. Effective progress includes a relevant new fact, a resolved unknown, a verifiable draft improvement, successful plan submission or verifiable node output. More tools, Tokens or identical summaries do not reset the counter. With planning observation enabled, further truncation after first recovery triggers planning progress inspection to identify a smaller next output; with observation disabled, count only directly verifiable outputs as progress and retain the no-progress count when uncertain. required review failure cannot default to continuation. Recovery counts do not replace task deadlines or external evaluation limits.

### 2. Observe plan formation

Add a distinct “planning progress” checkpoint, separate from submitted-plan “coverage” and execution “progress”. A task can have no DAG yet: do not require a current node, treat tentative ideas as approved, or evaluate nonexistent node completion. Retain the `planning` phase, with planning summaries and review job records expressing investigation, draft formation and unresolved questions.

Initially reuse existing observation settings: 24 accumulated tool results, five minutes with completed tool activity, or three consecutive tool errors trigger inspection at the next `agent/pre-step`; actual truncation can trigger earlier at idle. These values match current observation defaults but require validation for planning. When a normal `completed` turn ends without a submitted plan or a pending user question, also inspect the next action at idle: review newly uninspected activity, then deliver a concrete output if evidence supports continuation. Record this separately from truncation recovery. Triggers request inspection only. Do not repeatedly review the same cutoff without new activity or force necessary research into a fixed number of turns.

The reviewer reads current user requirements, evidence of applicable project-rule reads, tool inputs/results and public answers since the previous reviewed interval, paging backward when needed. Inspect preserved requirements, whether investigation reduces unknowns, plausible draft dependencies, whether evidence suffices for submission, and questions only the user can decide. Findings cite sources and a cutoff; absence of a report does not establish absence of progress. Outcomes may record, deliver an evidence-backed next action, or pause for a user decision, without expanding product scope.

The planning summary separates confirmed facts, assumptions to check, unknowns and the next output, bound to requirements version and evidence cutoff. The main Agent may supply summaries or drafts, but reviewers verify source evidence; supervision must not impose another mandatory tool call each turn. Store summaries in Session records underlying the existing task projection, retaining fact references and readers through compaction instead of creating another requirements or planning database.

After review at `agent/pre-step`, deliver necessary guidance as a plugin-sourced message; at idle, use the unified scheduling path. During a pure long model generation, the first version can observe available state but cannot promise interruption that changes generation already in progress: truncation or the next step provides the delivery boundary. Do not intervene by arbitrarily cancelling tools or adding per-tool bans. Planning retains native permissions and guidance against implementing deliverables before approval.

Bind review jobs to task, requirements version, evidence cutoff and state revision. New user input or state change while reviewing invalidates control conclusions; retain historical findings without applying stale decisions. Planning-review timeout, missing protocol and provider failure remain internal faults handled through existing bounded recovery; exhaustion displays a review fault rather than user disagreement or automatic acceptance. Planning observation never replaces full submitted-plan coverage review.

### 3. Optional automatic execution approval

Offer the task setting “execute automatically after independent plan review”. A user explicitly selects it during creation, discussion-to-task formation or waiting for approval; the controller records authorization source, task ID, requirements version, scope and revocation. A profile may hold a preference, but the effective automatic approval selection and inheritance source must be visible and durably recorded. Model claims that the user “should agree” cannot confer permission.

A formal plan must pass structural, dependency and requirement provenance validation, followed by independent confirmation of coverage. Automatic approval requires a valid coverage `pass` even if manual workflows allow disabling `planCoverageReview`; implementation must explicitly reject conflicting settings or require this mandatory review. No submitted plan, review failure, `revise`, `needs-user` and review faults all prevent approval. Timeout cannot become `pass`.

The controller checks unrevoked authorization, matching task and requirements version, matching plan version and review input, processed new user instructions and no required decisions. Reuse manual approval’s execution transition and read-only turn requirement. Record the actor as user-preauthorized policy with grant event seq, plan version and review job, never a fabricated user message; `task_approve` retains its direct-user approval validation. Racing automatic and clicked approval may persist only one execution transition and deliver one execution input.

The grant covers only initial execution approval for the current task and requirements version. Material objective edits, new requirements, task changes and forks invalidate its applicability; never carry an old task’s policy into the next task. Approved-task replanning follows its separate revision protocol rather than letting `everApproved` conceal scope changes. Pause, off, restart and repair after completion retain [lifecycle rules](../../../../docs/task-lifecycle.md) and [per-repair click confirmation](../../../../docs/completed-task-repair.md). Automatic approval confers no additional file, network, sandbox or publishing permissions.

### Presentation, records and implementation order

Preserve native main-Agent output in the main Session. Separate compact Supervisor notices show “continue planning”, “planning progress review” and “automatically approved under your setting”. The task summary shows the current planning output or formal DAG progress; the sidebar shows findings, evidence, recovery count and approval source, with pause, off and revocation controls. Actual automatic message content remains inspectable, explaining why work continued and what comes next. Language follows the task rather than English tool output.

| Batch | Delivery and acceptance | Reason |
| --- | --- | --- |
| 1 | Native truncation classification, bounded recovery, context and durable delivery reconciliation; commit and push after isolated acceptance | Address the observed planning stall while preserving execution approval. |
| 2 | Planning progress review, summaries and guidance at safe boundaries; commit and push after isolated acceptance | Establish whether another turn helps form a plan and limit repeated research and unsupported pauses. |
| 3 | Task preauthorization, automatic approval, UI and races; commit and push after isolated acceptance | Reduce manual waiting after a valid plan forms while retaining auditable authorization. |

Batch 1 can validate with manual approval; batches 2–3 then receive combined real-model checks. New durable fields, record versions, older-log reconstruction and Host/Client readers change together, with DSH persistence acknowledgements. Plugin modules may separate planning observation, recovery decisions and execution authorization, while the existing controller registers events and schedules. Do not modify native Goal/Plan drivers or add a host-loop truncation patch.

## Alternatives considered

**Raise the output limit alone.** Current data establishes that requests reached the configured limit, without proving larger allowances or model settings are available. Even if available, truncation and pre-submission stalls remain possible; model-route changes require a separate experiment and cannot replace state and recovery contracts.

**Send “continue” whenever idle.** Idle can also mean waiting for approval, a user pause or failed required review. Without ending causes, context and duplicate-delivery reconciliation, this can start unauthorized execution or repeat work.

**Review only submitted plans.** Existing behavior cannot detect failure to form a plan, so retain formal coverage review and add observation during formation.

**Let the reviewer directly direct the main Agent.** This adds a second continuation owner. Reviewers advise; the controller verifies versions, authorization and inbox state before scheduling, preserving current ownership.

**Automatically approve every task by default.** Users need a choice, and the project currently requires user confirmation of the initial plan. Recommend manual by default; automatic approval extends explicit preauthorization and requires corresponding authorization rules and tests when implemented.

## Acceptance criteria

- After a real reasoning-only `max-tokens` response, the same main Session automatically continues planning and eventually submits a plan. Without preauthorization, it waits for approval and does not implement deliverables early. Record every actual request and recovery message.
- Repeated ending or idle notifications create one continuation. User input, pause, off, clear, version changes, unsettled tools, existing queued work and required reviews block inappropriate continuation. Crashes do not redeliver work and restart remains manual.
- A truncated turn that subsequently produced a valid submission does not wake again from an old ending cause. Normal completion, cancellation, request failure, host interruption and internal reviewer truncation have distinct paths; main-Agent recovery in this batch must not silently rerun reviewers.
- Productive planning continues; repeated investigation without new facts, missed requirements or repeated tool errors receives traceable advice. Time/count-only tests do not establish corrective value. Pure long generation is influenced only at supported boundaries.
- Two recoveries without effective progress stop automatic continuation with an explanation; supported new facts can reset the count. Paging, omissions, compaction and language differences preserve constraints and evidence references.
- Automatic approval positives have user preauthorization, a valid formal plan and passed coverage review. Negatives cover stale grants, objective changes, revision requests, user decisions, internal faults, revocation and native permissions. Concurrent manual/automatic approval executes once, records the actual source, and cannot let `task_approve` fabricate authorization.
- UI distinguishes main Agent and Supervisor, tentative planning and formal DAG, execution authorization and final acceptance. Defects after completion still show impact and wait for the user’s confirmation click.
- A new comparison uses the same tasks, main model and scoring protocol, separately recording version, recovery count, time to first valid plan, approval wait, supported fact increments, submission/committed patch rates, independent reward, elapsed time and all Session Tokens. Preserve current original results; corrective benefit and false pauses remain unmeasured without blind annotations.

## Risks

Additional continuation and review consume Tokens and time; the model may again exhaust its per-request allowance. Bounded recovery provides fault tolerance, whose conversion into plans and implementation needs independent reward validation. Neither recovery counts nor successful submission establish task success.

Planning summaries can omit facts or misclassify progress. The original Session remains authoritative, with review cutoffs and pagination rather than substituting summaries for requirements. Provisional counts and observation frequency are not validated optimal policies.

Automatic approval changes the initial execution authorization contract. Before implementation, update project AGENTS and task lifecycle together with manual defaults, explicit preauthorization exceptions and revocation rules. Current code retains existing manual approval behavior. Per-repair confirmation and restart waiting are outside this proposal’s changes.

This proposal extends existing [review policy](../../../../docs/review-policy.md) and [Supervisor Session design](../../../../docs/session-runtime.md). This project previously had no Agent Note tree; related documents are partially extended and retain their lifecycle rules rather than being archived or overwritten.
