# DSH Task Supervisor

**Working native prototype, not a released plugin.** This project provides an independent `/task` workflow beside DSH Goal and Plan. The main Agent plans and executes in its normal Session; a deterministic controller owns task state and continuation, and a fresh read-only Agent reviews progress, stages, and completion. The reviewer may recommend a decision but cannot change workspace files or mutate the task directly.

The prototype currently requires a small DSH host extension for durable `extension/record` events and reader admission. That extension is in an isolated DSH worktree; it has not been merged into standard DSH. See [implementation status](docs/implementation.md) before installing.

## Current workflow

1. `/task new <objective>` starts one supervised task and asks the main Agent to submit acceptance criteria and ordered stages with `task_submit_plan`.
2. `/task` shows status. The initial plan waits for `/task approve` or the **Approve plan** button. Workspace-changing tools are guarded during planning.
3. After approval, the controller admits follow-up turns. The main Agent reports stage evidence with `task_report_stage`. A fresh reviewer reads bounded pages of the main Session log and returns `pass`, `revise`, or `needs-user`.
4. If a configured number of turns pass without a stage report, a progress reviewer decides whether to continue, correct course, or pause for the user. Once all stages pass, `task_request_completion` starts a separate final review. Only its `pass` decision marks the task complete.
5. `/task pause`, `/task off`, `/task on`, `/task resume`, `/task edit <objective>`, and `/task clear` control the lifecycle. The right sidebar shows state and the relevant controls, including an explicit **Close Supervisor** button. A host restart restores the task but waits for manual resume.

Reviewer model selection follows the main Agent's effective DSH route by default. `reviewerModel` may select another provider, model, and reasoning effort available through the active profile. Each review records its model, reviewer Session ID, evidence seqs, and main Session cutoff.

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
| [Architecture](docs/architecture.md) | Ownership and DSH integration design. |
| [Task state and control](docs/task-lifecycle.md) | Full multi-task lifecycle proposal. |
| [Review and intervention](docs/review-policy.md) | Review timing and user decisions. |
| [Evaluation](docs/evaluation.md) | Long-horizon dataset and Goal, Plan, and Team baselines. |
| [First prototype](docs/prototype.md) | Acceptance gates and comparison with Agent Team. |
| [Supervisor Session](docs/session-runtime.md) | Durable control and recovery design. |
| [Reviewer model](docs/review-model.md) | DSH profile model policy. |
| [Kernel experiment](docs/host-spike.md) | Initial capability investigation. |

The prototype currently supports one task per Session. The five-task queue, `/task plan` shortcut, independent executable acceptance fixture, user-configurable decision timeout, and long-horizon comparison are design work still to be implemented. Native Goal and Plan remain installed and retain their own commands; use a dedicated supervised Session to avoid two continuation controllers acting on one task.

[简体中文](README.zh.md)
