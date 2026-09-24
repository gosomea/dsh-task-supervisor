# DSH Task Supervisor

**Design and kernel experiments; no installable product plugin exists yet.** This DSH-native project aims to replace the user workflow of native Goal and Plan with one supervised task lifecycle. The main agent plans and executes in its existing session. A separate reviewer checks the recorded work, guides continuation, and independently assesses completion.

## Documentation

| Read | Purpose |
| --- | --- |
| [Architecture](docs/architecture.md) | Ownership and DSH integration. |
| [Task state and control](docs/task-lifecycle.md) | Bounded task list, JSON snapshot, right-panel controls, continuation, and recovery. |
| [Review and intervention](docs/review-policy.md) | Review timing, evidence access, automatic feedback, and user decisions. |
| [Evaluation](docs/evaluation.md) | Long-horizon coding dataset, baselines, and success measures. |
| [First prototype](docs/prototype.md) | Distinction from Agent Team, smallest complete execution loop, and acceptance gates. |
| [Supervisor Session](docs/session-runtime.md) | Durable control records, recovery authority, action delivery, and evidence reads. |
| [Reviewer model](docs/review-model.md) | Follow the main Agent or select a configured DSH model. |
| [Kernel experiment](docs/host-spike.md) | Executed capability checks, the external-event persistence gap, and remaining host validation. |
| [Project instructions](AGENTS.md) | Development rules and links to DSH source conventions. |

## Intended use

Users enter through independent commands, provisionally `/task new <objective>` for a task and `/task plan [request]` for planning first. The plugin selects single-round or autonomous multi-round execution and can change paths during work. The user confirms the initial interpretation and plan once before autonomous multi-round execution. The main agent adjusts the plan as evidence changes, and the supervisor reviews and drives continuation. See [architecture](docs/architecture.md) for the command proposal.

The proposed task list holds up to five unfinished tasks per session, with one execution slot. Commands go to the right-hand Supervisor panel and its server-side controller. A clear Close Supervisor button stops its work while preserving task state. Review runs mainly at plan and stage checkpoints, with a progress watchdog for extended stages. The main agent may request completion; the supervisor decides whether the available evidence supports it. A confirmed stall pauses work for a user decision. A host restart restores task state without silently resuming execution.

## Relationship to DSH

This independent out-of-tree plugin offers a functional alternative to Goal and Plan. Native plugins and their `/goal` and `/plan` entry points remain available. Supervisor owns separate commands, tools, state, and a right-hand panel using general DSH extension capabilities. The initial design uses a dedicated preset and fresh supervised sessions to avoid competing continuation controllers in one session; composition still requires validation. The existing [Jev verifier prototype](../dsh-jev-verifier/README.md) supplies lessons and candidate code.

[简体中文](README.zh.md)
