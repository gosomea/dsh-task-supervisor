# Supervisor session and recovery

**Status: design recommendation with a partial implementation.** This page owns durable records, recovery authority, action delivery, evidence reads, and fault acceptance; [implementation status](implementation.md) identifies the behavior already running, [task lifecycle](task-lifecycle.md) owns task semantics, and [kernel experiments](host-spike.md) record the earlier gap. A future same-repository `supervisor-session` module may separate these responsibilities; this prototype currently implements them inside the plugin and an isolated DSH host extension.

## Recommended structure

Introduce a **Supervisor Session**: replayable task-control records and their bindings to the main execution, review, and acceptance sessions. It provides recovery services and a unified audit view. Original main-agent messages, tool results, and supervisor records remain in one DSH Session log; reviewers retain their own native logs, referenced from the main log. `supervisor.json` and the unified timeline are rebuildable projections.

“Super session log” can describe this joined view. The durable design does not duplicate the complete main-agent transcript or create a second authoritative task file requiring dual-write synchronization with DSH. A complete logical view can join several native logs through explicit relationships.

| Layer | Ownership |
| --- | --- |
| DSH Session and persistence | Event ordering, single writer, physical logs, durability barriers, corruption detection, and format migration. |
| General host extension support | A readable format for external plugin records and execution admission when a required controller is missing or incompatible. This remains a gap. |
| `supervisor-session` | Control-record schemas, deterministic replay, projections, recovery reconciliation, action deduplication, evidence references, and bounded reads. |
| `dsh-task-supervisor` | Planning, review policy, next-action selection, completion decisions, and user interface. |

## Source and experiment findings

| Finding | Design consequence |
| --- | --- |
| [SessionPersistence](../../../deepseek-harness/packages/session/session-persistence/src/index.ts) already supplies read handles, exclusive write handles, and `flush()`. | Reuse its ownership and durability promises instead of implementing another log lock or writer. |
| The general `append` contract does not promise crash durability; `flush` is the barrier. | Await the barrier before acknowledging a control action or releasing dependent work. |
| [Session.append](../../../deepseek-harness/packages/core/session/src/index.ts) does not expose external-event compatibility metadata; unknown required events refuse reload. | Type augmentation alone cannot integrate the plugin. The earlier reproduction still applies. |
| The [`ignorable` contract](../../../deepseek-harness/packages/core/session/src/types.ts) permits only informational records whose omission cannot affect reconstruction. | Approval, shutdown, completion, and continuation records cannot simply be marked ignorable. |
| `runMaintenance()` owns the idle phase; the experiment holds its queued followup until after `flush()` and maintenance release. | Idle continuation can reuse this path for persistence-before-execution without another wake loop. |
| Native recovery retains pending inbox work; the experiment shows a later ordinary user message waking an old supervisor message. | Recovery must invalidate old permits and remove or quarantine owned stale messages through public inbox APIs. |
| `agent/created` initialization can run before execution; the experiment removes only stale supervisor messages and preserves human input. | This supports recovery when the controller is present; it does not establish admission protection when it is absent. |
| [Interrupted-turn repair](../../../deepseek-harness/packages/core/session/src/repair.ts) distinguishes unstarted tools from `TOOL_OUTCOME_UNKNOWN`. | Repaired turn boundaries do not imply successful business actions; unknown side effects require reconciliation. |
| [storage-domain](../../../deepseek-harness/packages/storage/storage-domain/README.md) supplies durable KV without adding Session events. | Use it for derived indexes and caches, not as a direct substitute for task-control events. |

## Alternatives

| Approach | Benefit | Cost and recommendation |
| --- | --- | --- |
| A task JSON file alone | Simple implementation and readable current state. | Missing approval, action, and review history makes crash windows ambiguous; do not use as authoritative history. |
| Copy every message into a new super log | Complete control over the format. | Adds dual writes, gap repair, fork, deletion, migration, and privacy copies; exclude from the first version. |
| Separate supervisor control journal with native logs as evidence | Avoids unknown Session event types. | A valid alternative, but needs delivery and receipts across two stores; it still cannot independently prevent host execution when the controller is absent. |
| Replace the entire SessionPersistence provider | Complete storage control. | Must preserve existing Sessions, migration, SDKs, exports, and core validation; too broad for the first version. |
| Native event extension plus supervisor recovery module | One ordered main control history with existing DSH persistence. | Requires general host support; recommended, beginning with a narrow executable experiment. |

A separate journal would change the current rule that the main Session owns supervisor events. Adopting it requires an explicit design revision and delivery protocol, not an invisible temporary workaround. A SQLite KV backend also does not imply transactions across Sessions or records; the existing [SQLite provider](../../../deepseek-harness/packages/storage/storage-sqlite/README.md) exposes single-statement KV write atomicity.

## Required host support

Explore a host-understood plugin-record envelope, provisionally `extension/record`, carrying namespace, binding identity, record kind, payload version, operation identity, and explicit evidence references. These are proposed names and fields, not existing APIs. Records are log-only; model-visible input still passes through the ordinary inbox and `user/message` path rather than projecting opaque payloads into model history.

Associated execution requirements must be checked by the host at creation, recovery, and next-step admission: required controller availability, supported record version, completed recovery, and valid execution permission. Requirements must be recoverable from durable records rather than inferred from the currently mounted plugin list. Registering event names without absence semantics does not solve the problem. The general admission check must remain effective after controller unload.

A compatible new host may inspect unfamiliar business payloads read-only, but executing the controlled session requires a compatible controller. Absence leaves it read-only with an explanation. An older DSH that does not recognize the general event type may still refuse the log under its current rules; downgrade readability is not promised. Storage format, SDK projections, exports, and adjacent migrations also need validation; this is not merely a boolean-parameter change.

`/task off` stops work while retaining the supervisory binding; ordinary conversation remains available when the plugin is loaded. It is different from removing the recovery module. Detachment is a separate explicit operation, allowed only after owned work settles, stale queues are withdrawn, and records are durable. It does not mark unfinished tasks successful. The first prototype may omit a detach command, but unloading must not silently restore controlled work as ordinary execution.

## Records and identities

| Record family | Minimum content |
| --- | --- |
| Binding and version | Supervisor-session ID, main Session ID, controller protocol version, schema version, and binding status. |
| Task and plan | Task ID and revision, requirement and acceptance IDs, plan revision, and human-instruction references. |
| Approval and user decision | Decision ID, approved requirement and plan revisions, source event; ordinary-prompt timeout remains distinct from explicit approval. |
| Review and acceptance | Job ID, attempt ID, task revision, evidence cutoff, actual model selection, result, and application status. |
| Action | Action ID, current activation epoch, target task revision, next-action summary, inbox message ID, and start/end references. |
| Recovery and stop | Interruption reason, reconciled facts, revoked permissions, stop state, and reason for awaiting the user. |

Every process recovery or controller remount creates a new activation epoch. It separates old callbacks and permits; a durable `active` state never grants execution authority to a new epoch. Old results may remain evidence but cannot directly control current execution.

Business events use stable UUIDs; raw DSH evidence references include Session ID, logical format version, and seq. A bare seq is not a permanent address across format migrations. Without a reliable reference mapping, preserve the old review as history and rebind evidence before new execution; do not guess by timestamps or similar text. Cross-session relationships use explicit parent and action references; timestamps are presentation data only.

Replay is a deterministic fold from saved records into state and reconciliation needs. It neither calls models nor runs tools nor approves work again. Snapshots retain their applied cursor, schema, and source-prefix identity; missing or stale snapshots rebuild, while ahead-of-log, corrupt, or unsupported snapshots cannot authorize execution. A failed control append must never fall back to an in-memory update followed by continued work.

## Action delivery and durability

1. Under the main Session's single-writer ownership, check task revision, activation epoch, human input, and review state, then allocate a unique action ID.
2. Append action preparation and await the durability barrier; do not acknowledge execution authorization before persistence succeeds.
3. While idle, use the verified `runMaintenance()` exclusive phase to queue a native inbox message carrying action ID, task revision, and epoch, await `flush()`, recheck permission, then leave maintenance. A followup queued there runs only after maintenance settles; never await this Agent's `whenIdle()` inside its maintenance task. Active turns still require step admission.
4. Recheck permission at final step admission and durably record admission; workspace effects must follow valid permission. An edit, pause, or off during an await invalidates old permission.
5. Correlate actual work through native inbox, request, tool, and turn events, then record settlement; duplicate delivery of one action cannot produce another valid admission.

The controller uses the Session's existing write path rather than claiming a competing handle. The first experiment can use existing service-wide `sessionPersistence.flush()`, which covers all live writers and can be affected by unrelated session failures. Add a public per-session barrier only if needed later; do not reach into the loop's private handle.

No general atomic transaction spans the log, model requests, file mutations, and network requests. The target is durable accepted control decisions, duplicate-admission suppression, and explicit unknown outcomes, not exactly-once arbitrary external effects. A recovered admission without a result requires external-state reconciliation; read-only or business-idempotent operations can be retried under a controlled policy.

## Recovery sequence

Block controlled execution first, acquire native Session write ownership, and finish physical reading and host interruption repair. After controller and schema validation, replay state and revoke previous-epoch permits; reconcile queued messages by source and action identity, removing or quarantining only owned stale input and preserving human messages. When cancellation must retain the inbox, use the host's `keepInbox` semantics and then remove messages by identity rather than clearing the entire inbox. Reconcile old review and acceptance results against task revision and evidence cutoff.

Record the recovery result and await the durability barrier before presenting actionable state. Default to awaiting manual resume; an old timeout cannot restart work. User resume rechecks workspace state, model routing, pending human decisions, and required evidence before creating a new-epoch action. Historical initial-plan approval may remain valid, while unresolved required decisions still block execution.

Stopping first revokes in-memory admission and requests cancellation of owned work, then persists the stop intent and waits for job convergence and the final barrier. A write failure keeps this process stopped and reports that the stop state was not durably saved; it cannot return success and continue execution. The next startup still waits for manual resume.

| Crash or failure point | Recovery response |
| --- | --- |
| Preparation not durable | Do not infer action acceptance; recover the last valid prefix. |
| Preparation durable, message not queued | Show undelivered; reconsider delivery after manual resume. |
| Message queued, no valid admission | Withdraw the old-epoch message; ordinary human input must not resurrect it. |
| Admission recorded, tool result absent | Mark outcome unknown; inspect artifacts or external systems instead of blind replay. |
| Review finished, control decision not applied | Validate task, schema, cutoff, and artifact identity before adoption; do not rerun a finished review to rewrite history. |
| Human edit precedes a late review | Retain historical findings and reject continuation or completion authority. |
| Snapshot corrupt, missing, or ahead | Rebuild from the valid log; never execute from the snapshot alone. |
| Controller missing or payload version unknown | A compatible host permits read-only diagnosis and rejects controlled execution. |
| Write-ownership conflict or durability failure | Grant no new action permission; display the concrete failure. |

## Evidence reads and joined view

The review tool initially returns current task context, the latest completed turn, an unreviewed-interval summary, and available read operations. Pagination cursors bind main Session, logical format version, task revision, cutoff, and read-policy version; bound responses by both event count and bytes. Returning only the last turn cannot replace complete coverage of a multi-turn stage.

Expand bodies by event reference, retaining event type, source, tool results, and unknown-outcome markers; make truncation, redaction, and missing artifacts explicit. Session text and tool output are evidence to assess, never higher-priority instructions. The tool cannot select arbitrary Sessions, mutate logs, execute workspace commands, or expose secrets excluded by its read policy.

Record retrieval separately from review coverage. Displaying the last page does not establish review of missing earlier pages; submissions list covered intervals and gaps, and insufficient evidence does not advance the accepted-review cursor. The joined timeline exposes causal references between main work, reviews, decisions, and actions instead of imposing cross-session order from timestamps.

Compaction summaries may aid discovery but do not replace original evidence. Deleted logs or artifacts yield unavailable references and invalidate dependent pending acceptance rather than reconstructing results from summaries. Main-session deletion and export must state which reviewer logs and artifacts are included; the first version must not label an export recoverable when required references are missing.

Fork follows [task lifecycle](task-lifecycle.md), creating new child task identities in a paused state; a prefix cutting required control records cannot form an executable recovery point. Distinguish host session clear from `/task clear`: inspect what the host actually retained before creating a new binding, and never revive a task merely because the Session ID is unchanged. Automatic migration of a task between main Sessions is outside the first version.

## Related design lessons

[Temporal event history](https://docs.temporal.io/workflow-execution/event) records scheduling and completion separately and uses durable history for recovery. The borrowed idea is separation of action state and replay; this design does not introduce a Temporal service or claim equivalent execution guarantees.

[LangGraph checkpointers](https://docs.langchain.com/oss/javascript/langgraph/checkpointers) preserve step state and pending writes for interruption and recovery. The borrowed idea is an explicit recovery point; a DSH Agent chooses its own tools, so unknown effects and manual resume still need policy. This comparison does not establish superior reliability.

## Implementation and acceptance order

Validate general plugin records and missing-controller admission first, then implement deterministic reducers, snapshots, and inbox recovery before wiring reviewer jobs and final acceptance. [Reviewer model policy](review-model.md) owns real model configuration. Host extensions are tested in an isolated checkout rather than the daily instance.

Required acceptance covers the failure matrix above, repeated recovery requests, two processes competing for ownership, off racing a late callback, fork cutoffs, controller hot unload, unknown schemas, the negative case of human input waking an old queue, and explicit user authorization before recovered execution. Follow injected-fault tests with actual process termination and restart tests, reporting their evidence separately.
