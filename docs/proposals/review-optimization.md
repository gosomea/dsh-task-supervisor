# Proposal for overall Supervisor review improvements

## Summary

This proposal makes each review answer which original requirements it checks, which evidence it obtains, which results it confirms, why it waits, and who acts next. Define review scope and evidence entry points first, improve fault handling and requirement findings next, then unify presentation and measure quality and cost.

Status: proposal awaiting implementation, 2026-10-09. This page does not change current behavior or imply a new release. Current capabilities belong to [independent review](../review-quality.md) and [process and recovery](../review-experience.md); observed problems and validation belong to the [diagnosis](../postmortem/2026-10-09-review-repair.md).

## Table of Contents

- [Basis](#basis)
- [Proposal](#proposal)
- [Delivery order and acceptance](#delivery)

<a id="basis"></a>
## Basis

The plugin already has snapshots, check plans, two independent review phases, actual read qualification, bounded protocol repair and fault recovery. Overall improvements must connect these capabilities more clearly and reduce unrelated reads and repeated judgments in long Sessions.

| Observation | Current evidence | Problem to address |
| --- | --- | --- |
| Evidence entry points search from the Session beginning by default | Original input reads and event indexes default to seq 0 and bind only the review cutoff | In a Session with multiple Tasks, the reviewer must identify task scope itself; this is an efficiency and attribution risk, not a confirmed false acceptance |
| Read counts do not describe verification coverage | Activity statistics count calls, successful reads and errors | Users cannot tell which requirements have been checked or remain unverified |
| Tool failures can end a review | A final failed read in the latest turn becomes a fault; protocol repair and internal retries use separate paths | Correctable argument errors need an explicit correction path without rerunning the whole review |
| Native process display exists, but several places derive status | Main transcript summaries, DAG and sidebar derive activity separately | Loading, orphaned jobs after restart and actual execution need consistent treatment; initial loading of an old pending job still needs a dedicated reproduction |
| Normal tasks still have substantial review cost | The latest log-mode task without injection took about 53, 108 and 93 seconds for plan, stage and completion reviews, with 55 successful tool results and 4 failures | This is one simple task and cannot establish long-term benefit; evidence retrieval needs a cost baseline |

These measurements describe workflow usability and cost, not review quality or superiority over Goal or Plan. Existing [machine records](../postmortem/2026-10-09-review-repair/validation.json) retain job duration and token categories.

<a id="proposal"></a>
## Dev Note: proposal

This section contains proposed behavior throughout. Implementation must update the owning current-state documents and retain separate validation records. Plugin configuration validates runtime tunables; evidence and safety requirements are not switches users can disable.

### 1. Define a clear scope for each review

The controller prepares reconstructable review input bound to the task, requirement version, plan version, node attempt, job, reviewer Session, cutoff and artifact snapshot. It records original requirements, additional constraints, authorization sources and their event locations, and states the question this review must answer.

Evidence retrieval prioritizes the current task, node attempt and changes. Relevant earlier standing constraints and shared-artifact history remain expandable by source; a task-start timestamp alone can omit earlier requirements and cannot replace attribution. Old logs without reliable attribution remain uncertain; no historical binding is invented.

Review input supplies requirement sources, applicable constraints, normalized dependencies, necessary inputs and capability descriptions. Main Agent claims identify their source; main reports, execution logs and earlier decisions stay locked until independent findings persist. Every model-visible input is logged in the native Session. Summaries locate evidence without replacing original content or actual checks.

| Checkpoint | Main question | Meaning of a pass |
| --- | --- | --- |
| Planning observation | Is the goal converging, are unknowns shrinking, is research repeating, and what planning output comes next? | Planning may continue; implementation is not approved |
| Plan review | Are original requirements covered, dependencies executable and required verification capabilities available? | Apply the existing approval policy; future deliverables are not verified |
| Progress review | Is actual work drifting, and are there new defects, genuine blockers or a need to revise the plan? | Continue or correct direction without repeating final acceptance |
| Node review | Does this attempt's artifact meet assigned requirements and work with relevant upstream and downstream parts? | Release dependencies without automatically accepting the whole task |
| Completion review | Does the current complete deliverable meet original requirements, including relationships among its parts? | Complete the Task after applying a valid decision |

### 2. Make evidence easy to locate and describe its support

Extend the existing index with task attribution, node attempts, change scope and read ranges, prioritizing relevant calls and paired results. Add bounded batch reads of originals to reduce index lookup, guessed seqs and repeated paging; preserve existing seq tools. Expansion obeys the same cutoff and independent-phase restrictions.

Each citable item identifies its original event or artifact, successfully read range, truncation and supported facts. Index summaries, failed calls, model claims and exit codes alone do not establish satisfaction. Findings based on partial reads remain limited to that content.

Within one job, reuse obtained originals and read qualification while recording cache hits and validity. Earlier decisions from other jobs are location hints; the current review must confirm artifact identity, relevant content and requirement applicability. Completion review binds a fresh snapshot rather than adding up earlier node passes.

### 3. Handle recoverable tool problems before pausing the task

Tool errors return a stable error type, failing fields, accepted ranges, available locators and the next action. Correctable read arguments or missing location qualification receive a bounded correction within the same job; only an actual successful read grants citation qualification. Decision validation reports missing requirements, invalid references and phase errors together to reduce sequential guessing.

| Condition | Proposed handling | Grants execution permission? |
| --- | --- | --- |
| Invalid arguments, paging errors or an unlocated reference | Give one explicit correction opportunity in the same job, then read and resubmit; repeated new errors cannot loop indefinitely | No |
| Missing or malformed decision | Retain bounded protocol repair without extending the attempt deadline | No |
| Timeout, connection failure, rate limit or temporary service error | Retain bounded internal retries; continue only with valid original identity, snapshot, phase and permission | No |
| Obtained evidence shows an unmet requirement | Return concrete corrections and affected scope to the main Agent; reopening a completed task still requires user confirmation | No |
| Necessary evidence or capability is missing | Persist an unverified finding and the gap, with an evidence or configuration action; never pass it | No |
| Authentication, configuration, unknown fault or exhausted retries | Preserve the incident and identify the pause reason and manual recovery action | No |
| User pause, disable, restart or a required user decision | Wait for manual recovery; old callbacks cannot continue the task | No |

Read correction, protocol repair and fault retry use separate counters under configured task and attempt deadlines. A validated plugin configuration controls read correction attempts, with a proposed default of 1 and range of 0–1. Protocol repair and read correction do not extend the current attempt. Retries do not bypass permission denial, stale snapshots or independent-phase restrictions.

### 4. Persist findings per requirement and state uncertainty

Extend existing requirement findings in plan, node and completion reviews with defined requirements so both log and independent modes record satisfied, failed or unverified status, method, actual evidence, coverage and limitations. Planning observations before a plan exists retain facts, unknowns and next actions; progress observations record drift and blockers. Log mode identifies checks against logs; independent mode identifies actual reads or runs. An independent Session identity grants no additional verification qualification.

The reviewer selects methods from original requirements: read static content, independently calculate or execute computations and behavior, and mark unavailable necessary observation as unverified. Existing tests remain usable after checking assertions and actual paths. Optional improvements without user support cannot become blocking requirements.

The controller validates job identity, evidence qualification, check coverage and decision format; the model judges whether evidence supports facts. Format validation cannot guarantee semantic correctness, so acceptance needs known-defect fixtures and independent scoring. New findings may extend the check plan while preserving prior independent findings; comparison reports cannot rewrite them.

Continuation handoff includes scope, confirmed facts, remaining requirements, specific corrections, evidence locations and the next actor. Users can see which issue passes to whom; the main Agent receives an actionable handoff. The controller still selects ready nodes and admits execution.

### 5. Use one activity interpretation across displays

Unify activity interpretation in the main transcript, DAG and sidebar, distinguishing durable outcomes from runtime facts. Unknown loading state says that status is loading; only a current runtime and events can establish an active review. Orphaned jobs after restart wait for recovery, and viewing history sends no model request.

The main transcript keeps native review details. Collapsed summaries show review type, node, current action, measured duration and next action. Running, recovery, fault and user-wait states have clear text and theme colors rather than only a small dot. Preserve explicit user collapse choices.

The DAG shows node and attempt progress; the sidebar expands requirements, evidence, coverage limits and history. Coverage may say that two of three requirements were checked and one is unverified, with identified sources and denominator. It cannot masquerade as task completion percentage. Current activity and the previous decision remain separate.

<a id="delivery"></a>
### Delivery order and acceptance

| Order | Deliverables | Required acceptance |
| --- | --- | --- |
| 1: scope and status | Review input attribution, relevant evidence priority, shared activity interpretation and current-state document consolidation | Multiple Tasks and earlier standing constraints are attributed correctly; unrelated history creates no requirement; cold loading and restart show no false execution |
| 2: retrieval and correction | Batch original reads, citations with actual ranges, explicit tool errors and bounded read correction | Invalid arguments can be corrected; summaries and failed reads remain uncitable; pause cancels correction; repair does not extend deadlines; independent phases remain isolated |
| 3: decisions and handoff | Requirement findings in both modes, final integration checks, actionable continuation and coverage presentation | Static documents, calculations, behavioral omissions, misleading reports and missing capabilities have positive and negative cases; optional preferences do not block valid artifacts |
| 4: long-horizon validation and release | Frozen comparisons under matching configuration, cost report, ordinary installation and release evidence | Both modes, multiple Tasks, rework, timeout, restart, changed artifacts and history subscription cleanup are tested; public package matches the validated artifact |

Each step runs focused kernel, native Host and user-visible snapshot checks, updates both languages, and receives its own commit and push. Client changes also run strict Host/Client typechecks, build and packaging. Real-model acceptance reuses a registered isolated environment and the daily model route without restarting in-flight tasks on daily port 3080.

Measure the current baseline first, then compare candidates with the same Host, profile, model, input, approval policy and deadline. Keep initial review frequency fixed, retain successful and failed positions, and provide no rescue to paused tasks. Previously analyzed questions remain development regressions; public questions retain the existing freeze and independent-scoring protocol.

Hard requirements: known invalid fixtures cannot pass; valid fixtures cannot fail because of optional preferences; user pauses cannot resume automatically; old artifacts cannot accept a new decision; jobs cannot start or apply twice. Controlled models and clocks test deterministic behavior. Real-model trials retain repeats and uncertainty.

Record final success or independent reward, requirement and independent-check coverage, tool faults, recovery counts, repeated reads, phase duration, tokens from the main and every reviewer Session, and user action counts. False acceptance and false pause need human or blind-review labels; keep unlabelled metrics null. Report verification quality separately from successful recovery, and check coverage alongside reductions in reads and duration.

This scope uses existing artifact reads, isolated command execution, public Sessions and native conversation components. Independent browser and visual executors remain later capability extensions; missing required capabilities are visible. Determine a patch version, freeze the tarball, test ordinary installation and publish after validation, without claiming improvements or superiority over Goal or Plan in advance.

## Accepted delivery order

1. Complete persisted reports in native Markdown, separate process folds, and a shared activity/application explanation.

2. Durable task/attempt/change scope, filtered indexes and original-evidence batches, with one job-wide read correction.

3. Requirement-level findings and concrete handoffs, review record version 8 with versions 1–7 readable.

4. Controlled regressions, registered real-model/browser checks, a frozen matched comparison, clean installation and the next available patch release.

Each step updates bilingual current-state documentation and evidence, then commits and pushes separately. Daily port 3080 remains running. Review frequencies remain unchanged; missing blind labels keep false-acceptance and false-pause metrics null.

## Complete reports and scoped review

The accepted optimization is implemented through record 8: full reports separate from native process folds, immutable review scope, original-evidence batches, bounded extra correction Turns, requirement outcomes and concrete handoff. Source gates, registered real-model positive/negative cases and the frozen two-fixture baseline comparison are recorded in [0.1.4 acceptance](../releases/0.1.4.md). Release state is reported there; the original runtime and capability boundaries remain.
