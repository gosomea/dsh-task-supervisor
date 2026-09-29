# DSH Task Supervisor

**Working native prototype, not a released plugin.** This project provides an independent `/task` workflow beside DSH Goal and Plan. The main Agent plans and executes in its normal Session; a deterministic controller owns task state and continuation, and a fresh read-only Agent reviews progress, stages, and completion. The reviewer may recommend a decision but cannot change workspace files or mutate the task directly.

The prototype currently requires a small DSH host extension for durable `extension/record` events and reader admission. That extension is in an isolated DSH worktree; it has not been merged into standard DSH. See [implementation status](docs/implementation.md) before installing.

## Current workflow

1. `/task new <objective>` starts one supervised task and asks the main Agent to submit acceptance criteria and ordered stages with `task_submit_plan`.
2. `/task` shows status. A fresh reviewer checks a submitted plan against the original objective and returns omissions for revision. After that review passes, the initial plan waits for `/task approve` or the **Approve plan** button. Planning retains native DSH tool permissions, including `run_code`, file and command tools for workspace investigation. The main Agent is instructed to wait for approval before implementing deliverables. The original `/task new` input is recorded and displayed as a native user message.
3. After approval, the controller admits follow-up turns. The main Agent reports stage evidence with `task_report_stage`. A fresh reviewer reads bounded pages of the main Session log and returns `pass`, `revise`, or `needs-user`.
4. If a configured number of turns pass without a stage report, a progress reviewer decides whether to continue, correct course, or pause for the user. Once all stages pass, `task_request_completion` starts a separate final review. Only its `pass` decision marks the task complete.
5. `/task pause`, `/task off`, `/task on`, `/task resume`, `/task edit <objective>`, and `/task clear` control the lifecycle. Plan, stage, and completion checkpoints show separate cards for the main Agent's submission and the Supervisor's independent review, with event and reviewer Session references. Each side's remaining content expands separately. The right sidebar shows state and the relevant controls, including an explicit **Close Supervisor** button. A host restart restores the task but waits for manual resume.
6. For a defect within a completed objective, propose impact through `task_propose_repair` or consultation. A user click returns the same task to its original DAG. Execution waits for confirmation; historical acceptance remains and affected nodes are reviewed again. See the [repair protocol](docs/completed-task-repair.md) and [validation evidence](docs/completed-task-repair-validation.md).

Both the main Session and current task consultation accept `/task` commands; sidebar commands reach the same main-Session controller. Ordinary consultation leaves the task unchanged; explicit “pause task”, “resume task”, or “new task: complete objective” after completion forwards a control action. New tasks and pauses open the sidebar’s Task details tab. Older consultation remains historical and cannot control a newer task. Its composer stays at the sidebar bottom; task controls belong to Task details.

After a task finishes, the same main Session can start another. The sidebar's **Task history** view reads completed and cleared tasks from the native Session log on demand, with read-only plans, nodes, and reviews. Its **New task** form submits to the existing `/task new` controller. The main Session's compact DAG follows only the current task; completed tasks show their final state without a prominent Clear task button. `/task clear` remains available for deliberate cancellation.

For objectives that require completed read-only model turns after approval, the plan can set `read_only_turns_before_write` (0–10). The controller blocks writes until that many read-only turns have completed; interrupted turns do not count. This gate covers this explicit action-order constraint; it does not compile arbitrary natural-language timing requirements into rules.

Before implementing a node, the main Agent records its node and attempt with `task_start_node`; ordinary questions do not start execution. Successful `task_rework_node` results produce a main-Session notice and DAG rework labels with attempt numbers. Node details retain the reason, prior acceptance, and affected descendants. Older Sessions rebuild these records from native tool logs. A previous pass never accepts a new attempt; missing start records do not imply execution.

Reviewer model selection follows the main Agent's effective DSH route by default. `reviewerModel` may select another provider, model, and reasoning effort available through the active profile. Each review records its model, reviewer Session ID, evidence seqs, and main Session cutoff.

Independent checks are opt-in. `independentVerification` makes node and completion review inspect current artifact snapshots and run independent checks before comparing the main report. Runtime criteria require independent execution. The plugin provides a Docker backend; independent browser checks remain pending. See [configuration and limits](docs/implementation.md#independent-artifact-checks-and-two-stage-review) and [real positive/negative evidence](docs/independent-verification-validation.md).

`truncationRecovery` is enabled by default: after a generation reaches its output limit, an admitted task may resume planning or execution once native tools and queues settle. `automaticContinuation: false` disables automatic new turns. `maxRecoveryWithoutProgress` defaults to 2; repeated recovery without novel verifiable tool output pauses for manual resume. Recovery messages, original turns, evidence and counts persist in the main Session; pause, off and restart never automatically resume.

## Development and isolated validation

Use Node 24 and an isolated DSH checkout containing the `extension/record` host seam. The daily DSH checkout and profile need no changes. The test runner resolves the checkout from `DSH_SOURCE`:

```sh
pnpm install
pnpm run build
DSH_SOURCE=/absolute/path/to/isolated-deepseek-harness node spikes/kernel/typecheck.mjs
DSH_SOURCE=/absolute/path/to/isolated-deepseek-harness node spikes/kernel/run.mjs
pnpm pack --dry-run
```

For a Web smoke test, build that checkout's Host and Client, initialize a separate `DSH_HOME` Web profile, then install `link:/absolute/path/to/dsh-task-supervisor` with DSH's `plugin add`. The bundle patch registers the Host plugin and the package manifest registers its Web client. [Implementation status](docs/implementation.md) records the verified layers and current limits.

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
| [Planning supervision and truncation recovery proposal](.agents/notes/proposed/feature/2026-09-29-planning-supervision.md) | Proposed: observation during plan formation, bounded contextual continuation and optional user-preauthorized execution approval. |
| [Evaluation design and execution roadmap](docs/evaluation.md) | Public benchmarks first; datasets, comparison arms, metrics, checklist, and development-result links. |
| [First prototype](docs/prototype.md) | Acceptance gates and comparison with Agent Team. |
| [Supervisor Session](docs/session-runtime.md) | Durable control and recovery design. |
| [Reviewer model](docs/review-model.md) | DSH profile model policy. |
| [Kernel experiment](docs/host-spike.md) | Initial capability investigation. |

The prototype executes one task at a time per Session and supports successive tasks after completion. The five-task queue, `/task plan` shortcut, user-configurable decision timeout, and formal long-horizon comparison remain future work. A lifecycle trial found a false completion decision on an explicit ordering constraint; an [independent regression case](eval/reliability-v1/README.zh.md) and real-model recovery run record the subsequent fix. Native Goal and Plan remain installed and retain their own commands; use a dedicated supervised Session to avoid two continuation controllers acting on one task.

[简体中文](README.zh.md)

Persistent consultation uses native Sessions and the host compaction backend. A dedicated isolated Web profile using root-scoped tools must enable the native `compaction-basic` and `command-compact` rows: Web normally moves them into Agent presets, so a bare root Session does not inherit them. Check that the command menu provides `/compact` and verify durable command completion and a compaction summary. Sending `/compact` as ordinary text does not compact history. Preset-based hosts should provide the same native capability in the appropriate scope, without mounting duplicate backends.
