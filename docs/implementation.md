# Implementation status

This page describes the runnable prototype as of 2026-09-27. The other design pages describe the intended product, including behavior that this build has not implemented.

## Review fault records (A)

Step A on 2026-09-28 adds independent durable review job records for plan, progress, node, and completion reviews, preserving task version, evidence cutoff, model, Session, and result event references. Task schema 8 still reads versions 1–7. Typed pause reasons and `reviewFault` represent internal failures without manufacturing `needs-user`; legacy unclassified records remain unchanged. The Web state API also returns bounded review jobs.

This step implements records and classification only; bounded repair, dedicated recovery controls, and draft conversations remain pending. Deterministic regressions using the registered isolated source and immutable source acceptance are in [step evidence](10-plans/conversation-and-review-recovery/evidence/a.md). These checks do not claim deployment to the user Web instance.

## V2 integrated acceptance

Core implementation of batches two and three is complete. All 52 kernel checks, both strict typechecks, isolated builds, and real-model integration regressions passed. Evidence covers DAG joins, persistent consultation and native compaction, interrupted-review recovery, default in-turn observation, native image reads, and two workers writing owned files before main-Agent integration. The [joint validation report](v2-integrated-validation.md) records first failures, repair commits, Session identities, and limits. A full shrine rerun and formal long-horizon evaluation remain pending, as does generic child-Agent catalog browsing.

## UI hierarchy and native answers

The latest UI regression passed 55 kernel checks, both strict typechecks, isolated builds, and browser validation. A real task progressed from plan approval to completion, with native main-Agent answers after planning, node review, and completion review. An external file check confirmed the sole artifact. See [UI validation](v2-ui-validation.md).

The executor rejects `todo_write` for unfinished supervised tasks so progress uses the DAG. Ordinary or cleared-task Sessions retain native todos. The extra native Task bar in the reported screenshot came from this checklist, not the `/plan` controller. Existing checklist events remain intact; the next native turn updates that projection.

## Native integration

The Host entry point is [`src/index.ts`](../src/index.ts). It registers `/task`, task model tools, lifecycle listeners, a tool execution guard, and an optional Web route. The Web client is [`src/client/index.tsx`](../src/client/index.tsx): it mounts into DSH's right sidebar tab and reads or controls the bound task through Connection's authenticated `/api/task-supervisor` Fetch route. The main Agent's text, Markdown, and attachments retain native conversation rendering without duplicate submission cards. After a checkpoint is committed, one tool-free model step can produce a native assistant response. The sole controller schedules the next node after that answer. Separate Supervisor summaries link to the matching full review in the sidebar. The route has no separate listening port and returns state derived from the Session. A closed Session can be read in bounded persistence pages; control actions require a live Agent.

The task record lives in the main DSH Session as `extension/record` events. [`src/state.ts`](../src/state.ts) validates and folds one full snapshot per transition. Reviewers have their own native child Sessions; the main record stores the reviewer Session ID, selected model, evidence seqs, and fixed main log cutoff. The reviewer gets `read_task_evidence`, which is bound to that main Session, returns at most 30 events per page, limits text, and redacts common key patterns. It can use `read_task_call` to inspect bounded arguments for one tool call by event sequence. A tool guard denies other reviewer tools. Main Session text is evidence, never reviewer instructions.

The companion Host change lives in an isolated `deepseek-harness-supervisor-seam` worktree. It adds one known log-only `extension/record` event and an effect-scoped `registerSessionControlReader(namespace, versions)` admission check on resume and before a step claims inbox input. A Session that needs an absent or incompatible reader refuses execution. This is a required DSH dependency, not yet a released public seam; the standard DSH build cannot run this prototype safely.

## Control behavior

The initial plan needs one explicit approval. `task_submit_plan` first runs an independent coverage review against the original objective; an omission sends the proposal back to the main Agent without making it the pending plan. While approval is pending, the main Agent may resubmit a whole plan; approval always applies to the latest plan version. Planning tool access is enforced at the executor. Later `/task edit` invalidates the prior plan and asks the main Agent to submit a full revision, without a second approval. A plan may set `read_only_turns_before_write`, requiring that many completed read-only model turns after approval before the controller admits writes. The count uses durable Session turns and successful read tool results; interrupted turns do not count. Approved work continues after each idle turn. `maxAutomaticRoundsWithoutReport` defaults to three; at that interval a fresh progress reviewer decides to continue, revise, or request a user decision. Stage reports and final completion requests each get a fresh review. A final `pass` is the only transition to `complete`.

State and queued Supervisor messages are flushed before waking the Agent. On restart, the task projection is restored, stale Supervisor messages are removed, and execution remains disarmed until `/task resume` or its panel button. An interrupted review keeps its submitted evidence in the durable state; manual resume asks the main Agent to verify current effects and resubmit the review. `/task off` cancels owned work and leaves the task record; `/task on` does not rearm it. Human input is not removed by the Supervisor's stale-message cleanup.

## Verification performed

- Strict DSH Host typecheck and two focused Host tests passed, including refusal on resume without a compatible reader and refusal after reader removal before the next step.
- Twenty-three kernel tests against real DSH services and scripted models passed, including rejection and resubmission after a failed plan coverage review, blocking writes until a completed read-only turn, and editing an objective during an executing model turn or in-flight stage review. The remaining tests cover approval guards, persistent manual recovery, progress review, off/on behavior, clear, fork, stage review, and completion. Scripted model output proves control wiring and safety gates, not review quality.
- The Host worktree's `doc-sync` gate passed all 42 checks. Its new persistence event has a bilingual same-version change record.
- A Node 24 package build and `pnpm pack --dry-run` included the Host bundle patch and Web client. In a separate `DSH_HOME`, DSH's `plugin add link:` installed the package and `--dump-config` showed the enabled row.
- An isolated DSH Web Host mounted the client. A task created through the real composer appeared in the right panel; the panel's **Close Supervisor** and reenable controls changed the native Session state; after Host restart the task reappeared with a manual **Resume task** control.
- Early card-version acceptance: reopening the real `spec-parser` Session in the isolated Web Host showed one main Agent plan card, then separate main Agent and Supervisor cards in each of the four review turns. Reviewer Session IDs, both event sequences, and separate expansion controls were visible.
- Real requests through the first CodeBuddy model in the daily profile exercised automatic continuation, the default three-round progress review, stage and completion reviews, and manual recovery after closing and restarting the Host. A two-case, three-arm [development pilot](../eval/pilot-v1/results-20260926.zh.md) used an external checker for Goal, Plan, and Supervisor; it does not establish a long-horizon advantage.
- An [independent temporal checker](../eval/reliability-v1/README.zh.md) fails the old false-pass Session. After the change, it passed a normal real-model run and a run interrupted during execution, restarted, and manually resumed. In the latter, the aborted turn did not count; completed read-only turn 3 preceded the first report write in turn 4.

## Current limits

The prototype holds one task per Session. It has no `/task plan` shortcut, five-task queue, complete product-level fork protocol, configurable user-decision timeout, or built-in executable artifact acceptance. It has no measured long-horizon advantage over Goal, Plan, or Team. A reviewer can cite Session evidence and judge completion, but its model decision is not independent benchmark scoring. A real run showed that stronger reviewer prompts alone were insufficient: the reviewer first rejected a same-turn read and write, then accepted a later redo as if it repaired the historical violation. The current controller gate covers plans that explicitly declare a completed read-only-turn-before-write rule. Other irreversible constraints still lack a general deterministic representation and enforcement. Cancellation during an in-flight remote request, Web controls across every Session lifecycle, and a formal held-out long-task set also remain unverified. The isolated Host seam is not yet a public part of standard DSH.

## V2 batch one: language and continuation context

Task record version 2 adds optional `responseLanguage` and stage `description`; the reader retains version 1 support without rewriting logs. New tasks detect Chinese, English, Japanese, or Korean prose, or use the plugin's explicit `responseLanguage` locale; `fallbackLanguage` defaults to `zh-CN`. Model system guidance, continuations, and independent reviews receive the language policy. Continuations retain the full objective and current criteria while adding the current stage, accepted nodes, and a bounded latest-review summary; truncation points to `task_status` for full content. Chinese output was verified in the batch-one real-model run; other languages remain untested.

## V2 batch one: decisions and current-task surfaces

Task record version 3 stores the last approval's plan version and direct user message sequence, while continuing to read versions 1 and 2. `task_status` exposes an eligible approval reference; `task_approve` checks task, plan, and direct user provenance, and repeated calls do not enqueue another continuation. The first version recognizes explicit short approvals such as “批准” and “批准当前计划”; negations, quotations, and requests with changes are not approval. Buttons and `/task approve` share the approval transition. Panel actions bind the task ID and state revision; stale clicks are rejected.

The native `conversation.input.dock` shows a compact DAG, recorded participants, task summary, accepted-node count, latest review heading, and actions. View details opens the full sidebar plan. Task details and Supervisor conversation occupy separate tabs with independently scrolling content and a fixed action footer. Both surfaces share state and control requests; reconnect reloads state and late reads cannot overwrite newer actions. Host admission determines available actions. History retains the latest 50 reviews; older links explicitly direct the reader to original logs instead of showing a different review.

Batch one has 34 passing tests, including exactly one continuation from approval inside a model turn, direct-user checks, stale control rejection, duplicate action coalescing, and polling convergence across remounts. A real CodeBuddy task verified Chinese plans and independent findings, chat approval, inline pause/resume with the sidebar closed, both stages, and final completion; an external rerun passed five Node tests. Raw model reasoning can still be English; the plugin cannot guarantee its language. See [batch-one validation](v2-batch1-validation.md) for environment and evidence.

## V2 batch two: provenance and pageable evidence

New plan criteria must identify a user requirement, project constraint, or implementation choice with a checkable source. Conversation and sidebar show the same provenance labels. Record version 4 reads versions 1–3; missing legacy provenance stays unknown rather than becoming a user requirement.

Review summaries expose truncation and continuation offsets. `read_task_text`, the extended `read_task_call`, and `read_task_context` retrieve event text and full task context inside the fixed cutoff. Independent review checks whether sources support criteria and excludes unrelated fixtures; structural origin validation does not replace semantic judgment. Long-turn observation and image reads are described below; see [provenance and evidence validation](v2-evidence-validation.md).

## DAG state and attempt identity

Record version 5 adds dependencies and independent node runs. `dependsOn: []` denotes a root; omitted legacy dependencies retain the adjacent chain. `stageIndex` is a selection, not an accepted count. Reports may target any dependency-ready node; review passes release successors, and completion requires every node to pass.

`task_rework_node` invalidates the selected node and its descendants, advances attempt IDs, and retains unrelated branches. Reports must identify the current `attempt` after rework. Resuming interrupted active nodes also starts a new attempt and requires checking uncertain side effects. Host regressions cover out-of-order independent reports, join gating, and rework invalidation. Graph rendering, parallel delegation, and combined real-model acceptance remain subsequent modules.

## Long-turn observations

Native `agent/pre-step` boundaries trigger independent progress review by tool-result activity, elapsed time, or consecutive tool errors without another timer-driven continuation loop. Defaults are 24 tool results, 300000 milliseconds, or 3 consecutive errors, configured by `observationToolCalls`, `observationIntervalMs`, and `observationConsecutiveErrors`. `observeLongTurns: false` disables observation. Wall-clock time without new tool activity does not trigger a check.

Persisted pass or revision findings enter the next model step as a native message within the same turn; they do not accept a node or start another execution turn. A user decision pauses execution. Callbacks must match the task revision; edits and closure cancel them. Scripted-model regressions cover activity and controlled-clock triggers, productive continuation, and stale results after closure. Real-model acceptance is deferred to combined batch-two/three integration.

## Native image evidence

Record version 6 stores visual criterion types, attempt evidence boundaries, and inspected image sequences. `read_task_image` accepts only native images from already-paged events within the review cutoff and current attempt. Attachment storage verifies content before a native image block enters the model request. Required visual criteria cannot pass without an inspected image. Routes without declared image input, unavailable attachments, or stale evidence return errors and require an unable-to-verify finding.

All 47 kernel checks pass, including native attachment delivery to review requests, text-only route rejection, and stale-attempt rejection. These checks do not establish real-model visual judgment quality.

## DAG presentation

The sidebar draws persisted DAG edges, stacks nodes in the same dependency layer, and centers joins. Nodes show only a short title and status. Hover or keyboard focus reveals descriptions and acceptance criteria; selecting a node retains its full details. Narrow panes scroll horizontally. Colors, borders, and backgrounds use DSH Web theme variables. The main conversation uses the same graph in compact mode: ongoing tasks expand by default and completed tasks collapse. Explicit expansion choices persist per task. Nodes and recorded participants open the matching sidebar details.

## Persistent consultation

`/task consult` and the sidebar button reuse a native Session bound to the main Session and task. The sidebar embeds SessionProvider and conversation.content for native history, composer, model controls, and /compact rather than implementing a second chat log or compressor. New questions receive timestamped, versioned task context. Ordinary questions are read-only. Restart retains the binding while main execution still needs manual recovery.

Explicit directives such as pause, resume, approval, disabling supervision, and replacing the full objective pass through `supervisor_control` to the existing controller. It checks the latest direct user message and task revision. The main log records received before execution and applied/failed afterward. Repeated user sequences cannot execute twice; interrupted received receipts require checking current effects. Forked or replaced-task conversations cannot control the original task, and pre-restart directives cannot replay automatically. All 48 Host checks pass; native embedding, actual compaction, and real-model consultation remain integration checks.

## Controlled native delegation

The main Agent can call `task_delegate_nodes` for dependency-ready nodes, defaulting to two concurrent workers (`maxParallelNodes`: 1–8). Record version 7 stores child Session identity, attempt, settled child cutoff, and main integration boundary. Write scopes are exact workspace files; native filesystem target identities must be disjoint. Directory claims are not admitted. Workers read/search/write/edit owned files, while the main Agent runs commands and integration. No second main-task continuation loop is introduced.

Submitted workers enter awaiting-integration. A successful main-Session verification tool result after settlement (bash/read_image by default, configurable with `integrationTools`) is required before node review. The reviewer must inspect the bound worker log and main integration evidence before accepting a node. Pause, disable, and task edits cancel workers; stale results cannot settle. Recovery advances attempts and requires checking effects.

All 50 checks and separate strict Host/Client typechecks pass. Native filesystem tests hold both model requests concurrently, reject foreign writes, overlapping claims, and reports before integration, and verify closure prevents writes and continuation. Successful tool execution is an admission condition, not proof of correct coverage. Arbitrary worker shell execution is intentionally unavailable in this shared-directory strategy; such nodes run serially in the main Agent. Worktree-isolated general tools remain a later extension.

[简体中文](implementation.zh.md)

## Planning semantics found during integration

A real model placed predecessor integration checks in a successor gated on predecessor acceptance, and mislabeled explicit user requirements as implementation choices. Independent review initially missed both; that run is not a pass. Planning and review contracts now explain acceptance dependencies, checks before node review, explicit node counts, and source classification. All 50 kernel checks and both strict typechecks pass; real-model reruns are recorded separately.

## Interrupted review and native compaction configuration

Resuming a read-only review preserves the settled execution attempt and worker cutoff; interrupted execution or rework advances attempts. Regression coverage checks retained evidence and gated successors; all 51 checks pass. Browser acceptance found native compaction absent from the isolated Web profile. The README now specifies its native backend composition. A model falsely reporting success for an ordinary `/compact` message is recorded as a failure; consultation instructions now require a native command result.

## Web scope integration fixes

Web presets register filesystem tools in the main Agent scope. Looking only at the global catalog left workers without file tools. Delegation now explicitly registers read/glob/grep/write/edit from the main native tool view while retaining execution and filesystem guards. Kernel fixtures use the same scoped layout. Image reading also declares the Cordis llm service injection; the earlier real review correctly paused on the missing service rather than accepting an executor description.

## Worker settlement and failed-turn convergence

Workers may report through task_worker_done or a nonempty final text after a normally completed native turn, selected with DSH finalAssistantOutput. Neither path implies acceptance: main integration and independent review still follow. Abnormal or empty reports pause the task and conclude the current main turn. Regressions cover scoped tools, normal final text, empty reports, and no additional model step after failure.
