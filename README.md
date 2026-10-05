---
description: "Add persistent tasks, plan reviews and Supervisor consultation to a DSH Web profile."
kind: "package-bundle"
---

# DSH Task Supervisor

## Summary

**Add plan review, progress tracking and completion checks to long DSH tasks.** The main Agent plans and executes. Supervisor persists task state and starts a separate review Session at planning, stage and completion checkpoints. Follow progress in the main conversation’s compact DAG, then inspect plans, evidence and consultation in the sidebar.

[简体中文](README.zh.md) · [npm 0.1.1](https://www.npmjs.com/package/dsh-task-supervisor) · [Report an issue](https://github.com/gosomea/dsh-task-supervisor/issues)

**0.1.1 development preview.** Its independent `/task` workflow coexists with native DSH Goal and Plan. A deterministic controller owns task state and continuation; reviewers provide decisions. Default review reads the main Session log. Independent artifact reads and isolated command checks require explicit configuration.

## Installation requirements

This version installs into unmodified public DSH. It uses native Session records and Agent presets for persistence and execution admission; no Host patch or custom build is required. See [installation validation](docs/native-install.md) for verified versions and migration limits.

## What you can do

- **Review plans before execution**: check coverage of the original requirements. User approval is the default; explicit preauthorization can admit execution after a passing review.
- **Track progress and rework**: the DAG shows node states, participating Agents and attempt counts, with reasons and affected dependencies retained.
- **Consult the Supervisor**: discuss objectives or ask about progress in the sidebar, and explicitly pause, resume or close supervision.
- **Repair completed work**: inspect the proposed impact and confirm a return to the original task and DAG, retaining earlier acceptance records.

![Main conversation DAG and sidebar rework details](docs/assets/rework-attempt-details.png)

*An earlier isolated validation example showing a passed node entering a new rework attempt and its dependency impact.*

## Installation and version scope

Use Node 24 and official DSH `0.2.0-rc.2`, with its Web profile and your existing model configuration. Add this bundle to that profile and start DSH:

```sh
dsh plugin --profile web add dsh-task-supervisor@0.1.1
dsh web
```

The npm package contains the built Host plugin, Web client, check gateway and bundle patch. In a blank Session, run `/task new <objective>` before its first model turn; DSH selects a Supervisor variant of its current preset. To discuss requirements first, select the Supervisor mode before sending the first message. Ordinary modes retain Goal and Plan; Supervisor mode has one task controller. A started ordinary Session cannot change its native preset: create a new Session for supervision.

If an independent command modifies the captured artifact tree, its evidence is invalid and subsequent checks are rejected; automatic check-directory recovery has not passed validation. This version retains that limitation. Default review uses main-Session logs; independent artifact checks need explicit configuration and independent browser observation is unavailable. See [implementation status](docs/implementation.md).

## Planning supervision

Planning supervision is enabled by default (`planningSupervision`; `maxPlanningWithoutProgress: 2`). Before a submitted plan exists, native step boundaries use the existing activity observation thresholds; a completed planning turn without a submission, or a second truncation after recovery, also requests an independent planning review. Its evidence-linked facts, unknowns and next action stay bound to the requirements version. A pass only continues planning. `needs-user`, exhausted internal recovery and repeated independently judged lack of progress pause with distinct reasons. Disabling `automaticContinuation` prevents new rounds; disabling `observeLongTurns` suppresses in-turn observation, while `planningSupervision: false` suppresses planning reviews entirely.

## Current workflow

1. `/task new <objective>` starts one supervised task and asks the main Agent to submit acceptance criteria and ordered stages with `task_submit_plan`.
2. `/task` shows status. A fresh reviewer checks a submitted plan against the original objective and returns omissions for revision. After that review passes, the initial plan waits for `/task approve` or the **Approve plan** button by default; explicit `after-review` preauthorization admits it automatically. Planning retains native DSH tool permissions, including `run_code`, file and command tools for workspace investigation. The main Agent is instructed to wait for approval before implementing deliverables. The original `/task new` input is recorded and displayed as a native user message.
3. After approval, the controller admits follow-up turns. The main Agent reports stage evidence with `task_report_stage`. A fresh reviewer reads bounded pages of the main Session log and returns `pass`, `revise`, or `needs-user`.
4. If a configured number of turns pass without a stage report, a progress reviewer decides whether to continue, correct course, or pause for the user. Once all stages pass, `task_request_completion` starts a separate final review. Only its `pass` decision marks the task complete.
5. `/task pause`, `/task off`, `/task on`, `/task resume`, `/task edit <objective>`, and `/task clear` control the lifecycle. Plan, stage, and completion checkpoints show separate cards for the main Agent's submission and the Supervisor's independent review, with event and reviewer Session references. Each side's remaining content expands separately. The right sidebar shows state and the relevant controls, including an explicit **Close Supervisor** button. A host restart restores the task but waits for manual resume.
6. For a defect within a completed objective, propose impact through `task_propose_repair` or consultation. A user click returns the same task to its original DAG. Execution waits for confirmation; historical acceptance remains and affected nodes are reviewed again. See the [repair protocol](docs/completed-task-repair.md) and [validation evidence](docs/completed-task-repair-validation.md).

Both the main Session and current task consultation accept `/task` commands; sidebar commands reach the same main-Session controller. Ordinary consultation leaves the task unchanged; explicit “pause task”, “resume task”, or “new task: complete objective” after completion forwards a control action. New tasks and pauses open the sidebar’s Task details tab. Older consultation remains historical and cannot control a newer task. Its composer stays at the sidebar bottom; task controls belong to Task details.

After a task finishes, the same main Session can start another. The sidebar's **Task history** view reads completed and cleared tasks from the native Session log on demand, with read-only plans, nodes, and reviews. Its **New task** form submits to the existing `/task new` controller. The main Session's compact DAG follows only the current task; completed tasks show their final state without a prominent Clear task button. `/task clear` remains available for deliberate cancellation.

For objectives that require completed read-only model turns after approval, the plan can set `read_only_turns_before_write` (0–10). The controller blocks writes until that many read-only turns have completed; interrupted turns do not count. This gate covers this explicit action-order constraint; it does not compile arbitrary natural-language timing requirements into rules.

Before implementing a node, the main Agent records its node and attempt with `task_start_node`; ordinary questions do not start execution. Successful `task_rework_node` results produce a main-Session notice and DAG rework labels with attempt numbers. Node details retain the reason, prior acceptance, and affected descendants. Older Sessions rebuild these records from native tool logs. A previous pass never accepts a new attempt; missing start records do not imply execution.

Reviewer model selection follows the main Agent's effective DSH route by default. `reviewerModel` may select another provider, model, and reasoning effort available through the active profile. Each review records its model, reviewer Session ID, evidence seqs, and main Session cutoff.

Log review is the default. New configurations explicitly set `reviewVerification: independent` and provide `independentVerification.storageRoot` to enable requirement-driven plans and two-phase artifact acceptance. Read-only requirements need no command runner; computation or behavior checks require a container and toolchain. Existing `independentVerification`-only configurations retain their legacy protocol without invented historical plans. Independent browser checks remain unavailable. See [configuration](docs/implementation.md#independent-artifact-checks-and-two-stage-review) and [current real-model validation](eval/independent-verification/generic-quality-20260930/README.md).

`truncationRecovery` is enabled by default: after a generation reaches its output limit, an admitted task may resume planning or execution once native tools and queues settle. `automaticContinuation: false` disables automatic new turns. `maxRecoveryWithoutProgress` defaults to 2; repeated recovery without novel verifiable tool output pauses for manual resume. Recovery messages, original turns, evidence and counts persist in the main Session; pause, off and restart never automatically resume.

`planningSupervision` defaults to `true` and checks plan formation before submission. `executionApproval` defaults to `manual`; select `after-review` in the profile or use `/task auto-approve-on` before first approval to preauthorize execution after an independent formal plan pass. `/task auto-approve-off` revokes it, including during review. Editing requirements clears approval and preauthorization. [Validation](docs/planning-supervision-validation.md) separates deterministic checks from real-model probes.

## Development and isolated validation

Use Node 24 and an installed unmodified DSH source checkout for source tests. These commands read the checkout without building or changing it; `DSH_SOURCE` selects its path:

```sh
pnpm install
pnpm run build
DSH_SOURCE=/absolute/path/to/deepseek-harness node spikes/kernel/typecheck.mjs
DSH_SOURCE=/absolute/path/to/deepseek-harness node spikes/kernel/run.mjs
pnpm pack --dry-run
```

For installation acceptance, use official npm DSH in a registered isolated `DSH_HOME` and install the packed tarball through `dsh plugin --profile web add /absolute/path/to/package.tgz`. No source Host/Client rebuild, manually linked SDK or private event-reader API is used. Native components are peer dependencies supplied by DSH, so the plugin does not replace Host components with a different version.

## Design and evaluation

| Read | Purpose |
| --- | --- |
| [Implementation status](docs/implementation.md) | Actual code, installation prerequisite, tests, and limits. |
| [Supervisor interaction proposal](docs/supervisor-experience-v2.md) | Shrine Session findings, response language, task graph, decisions, and persistent consultation. |
| [Conversation and review recovery plan](docs/10-plans/conversation-and-review-recovery/plans.md) | Proposed: forming tasks through discussion, bounded protocol repair, fault tracing, and review frequency experiments. |
| [V2 integrated validation](docs/v2-integrated-validation.md) | Real-model checks of batches two and three, DAGs, persistent consultation, workers, and failure repairs. |
| [Rework and execution validation](docs/rework-progress-validation.md) | Explicit main-node starts, prior acceptance, affected descendants, and older-log recovery. |
| [Independent verification and repair after completion](docs/10-plans/independent-verification/plans.md) | Repair, snapshots and two-stage independent execution are validated; independent browser and joint regression remain pending. |
| [Architecture](docs/architecture.md) | Ownership and DSH integration design. |
| [Task state and control](docs/task-lifecycle.md) | Full multi-task lifecycle proposal. |
| [Review and intervention](docs/review-policy.md) | Review timing and user decisions. |
| [Planning supervision and execution approval](.agents/notes/implemented/feature/2026-09-29-planning-supervision.md) | Implemented: planning observation, contextual recovery, bounded reviewer supplementation and explicit execution preauthorization; evidence and limits linked. |
| [Evaluation design and execution roadmap](docs/evaluation.md) | Public benchmarks first; datasets, comparison arms, metrics, checklist, and development-result links. |
| [First prototype](docs/prototype.md) | Acceptance gates and comparison with Agent Team. |
| [Supervisor Session](docs/session-runtime.md) | Durable control and recovery design. |
| [Reviewer model](docs/review-model.md) | DSH profile model policy. |
| [Kernel experiment](docs/host-spike.md) | Initial capability investigation. |

The prototype executes one task at a time per Session and supports successive tasks after completion. The five-task queue, `/task plan` shortcut, user-configurable decision timeout, and formal long-horizon comparison remain future work. A lifecycle trial found a false completion decision on an explicit ordering constraint; an [independent regression case](eval/reliability-v1/README.zh.md) and real-model recovery run record the subsequent fix. Native Goal and Plan remain available in ordinary modes; the generated Supervisor preset disables their workflow rows only in supervised Sessions. A profile preset edit takes effect in new Supervisor composition after a Host restart.

[简体中文](README.zh.md)

## Model Experience

The main Agent uses `/task` and task tools; original inputs and model answers retain native rendering. Reviewers use bounded evidence and constrained inspection tools. A separate review Session alone does not prove independent execution or observation; the panel reports the effective verification mode. Consultation and compaction inherit native preset capabilities without another root-scoped compaction backend.

## Known Limitations and Deferred Work

Private 0.1.0 extension logs cannot restore directly in public DSH: retain their original Host and start a fresh 0.1.1 Session. This release migrates or rewrites no historical log. A started ordinary Session cannot become supervised; select the mode before starting a new Session. Successive tasks retain prior history. Independent browser checks and automatic check-directory recovery remain unavailable; installation acceptance does not establish long-horizon superiority over Goal/Plan.
