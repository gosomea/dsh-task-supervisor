# Repair after completion

A defect within the original objective returns to the original task and DAG through a repair proposal. Ordinary questions only inspect status. Every reopening requires the user to click the displayed impact confirmation; new features use a new task draft.

## Proposal and confirmation

The main Agent uses `task_propose_repair`; the consultation uses `supervisor_propose_repair`. Both bind task identity and revision, a short title, defect reason, root nodes and main-Session evidence sequences. Users can also propose repairs from current or historical task details. Proposals retain their source and proposer Session identity; the UI distinguishes main Agent, consultation and manual user proposals without inventing identities for older records.

The controller persists the proposal in the main Session and computes the union of roots and descendants. Shared descendants advance once. A proposal preserves completion and grants no execution authority. The compact overview links to the impact panel, whose controls use native DSH buttons. Main Agent replies remain unchanged.

Once the current task completes, the main Agent may read diagnostic evidence, inspect task status or propose repair. Implementation tools are denied before a proposal, while awaiting a decision and after declining repair. Generic code, shell and unknown tools can modify artifacts; a diagnostic description grants no execution authority. A successful user-confirmed reopening restores implementation, and an explicitly created and approved new task can execute its new objective. Approval, node rework and resume cannot substitute for the click. Planning continues under native DSH tool permissions. This admission control is not a filesystem sandbox and cannot prevent writes by external processes.

The authenticated Connection Fetch endpoint binds the click to the proposal and target revision. After the main Agent becomes idle, a native maintenance window checks the execution slot, task revision and workspace identity, persists the confirmation receipt, appends the deterministic reopened state and persists continuation. A failed check grants no execution. Another active task returns `ACTIVE_TASK_CONFLICT`; there is no preemption or automatic queue.

Repeated confirmation of an applied proposal does not wake another turn. A new proposal supersedes pending proposals. Declining preserves completion, and historical prose cannot create fresh authorization.

## Workspace identity limitations

The native filesystem captures directory metadata and content hashes twice. Untracked and uncommitted files are included; root `.git` metadata is excluded. Changes after proposal return `ARTIFACT_CHANGED` and require a refreshed proposal.

Default limits are 10000 entries and 256 MiB, configurable through `repairMaxFiles` and `repairMaxBytes`. Exceeding them fails explicitly. Symlinks and special files return `ARTIFACT_UNSUPPORTED` pending a dependency policy. Missing native filesystem or bound workspace returns `ARTIFACT_UNAVAILABLE`.

This stamp binds confirmation to the workspace shown in the proposal. It is **not an independent acceptance snapshot and does not prove the previously accepted implementation remains correct**. External writes after validation need the next runner policy. This step does not add independently executed verification; completion still uses the existing reviewer.

## Acceptance cycles and history

Confirmation retains task ID, objective, approved plan and DAG, incrementing `acceptanceCycle` from an implicit first cycle. Roots and descendants advance attempts and require new review; independent nodes retain acceptance. Final acceptance is cleared and must be requested again. `repairHistory` preserves prior runs, completion review, completion time when known, confirmation time, cause and impact.

Reopening a historical task restores its review and rework records and archives the previously current terminal task. History remains unique by task ID across repeated repairs.

Restart restores proposals without implementing them. A confirmed proposal whose state transition was interrupted requires another click. Restart after reopening uses the existing manual `/task resume` path. Disabled supervision or changed revisions block stale proposals; old reviewer callbacks remain version-bound.

## Persistence contract

Task state schema advances from 9 to **10**, reading 1–10. New cycle, completion timestamp and repair history fields are optional; proposal origin belongs to the repair namespace. Old records acquire no fabricated timestamps or receipts. Projection cache version advances from 10 to **11** and rebuilds current and historical tasks from native logs.

The new `dsh-task-supervisor-repair` namespace uses schema **1** with `proposal`, `confirm` and `decline` records. Confirmation carries `source=web-confirmation` and an exact target. The projection accepts only its matching deterministic completed-to-active transition. Unsupported reopening records block execution. The proposal window retains 50 entries while original events remain durable.

Readers use Cordis effects. DSH reader admission rejects controlled Sessions when an older plugin lacks schema 10 or the repair namespace, preventing an unsupervised fallback. Client, cold reads, history and model status consumers read the new fields together.

[Enhancement plan](10-plans/independent-verification/plans.md) · [简体中文](completed-task-repair.zh.md)
