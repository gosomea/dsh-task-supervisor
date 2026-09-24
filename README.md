# DSH Task Supervisor

**Design proposal; no installable plugin exists yet.** This DSH-native project aims to replace the user workflow of native Goal and Plan with one supervised task lifecycle. The main agent plans and executes in its existing session. A separate reviewer checks the recorded work, guides continuation, and independently assesses completion.

## Documentation

| Read | Purpose |
| --- | --- |
| [Architecture](docs/architecture.md) | Ownership, task lifecycle, persistence, and DSH integration. |
| [Review and intervention](docs/review-policy.md) | Review timing, evidence access, automatic feedback, and user decisions. |
| [Evaluation](docs/evaluation.md) | Long-horizon coding dataset, baselines, and success measures. |
| [Project instructions](AGENTS.md) | Development rules and links to DSH source conventions. |

## Intended use

Users continue to enter through `/goal` and `/plan`. Both commands lead to the same supervised task lifecycle: `/goal` expresses a persistent objective, while `/plan` starts with planning and user review. The command is a starting preference, not a fixed task-length rule. The plugin selects a short, single-round path or autonomous multi-round continuation according to the task and may switch paths while work is in progress. Before the first autonomous continuation, the user confirms the initial task interpretation and plan once. The main agent can update the plan as evidence changes. The supervisor reviews those changes against the user's instructions in the same session log and starts another round when work remains.

The main agent may request completion; the supervisor decides whether the available evidence supports it. A confirmed stall pauses work for a user decision. A host restart restores task state without silently resuming execution.

## Relationship to DSH

This is an out-of-tree DSH plugin project. Its target profile will preserve the `/goal` and `/plan` command names while replacing the native Goal and Plan controllers, rather than running two controllers over the same session. It will use DSH plugin registrations, durable session events, projections, agent lifecycle hooks, and the native client extension points. The existing [Jev verifier prototype](../dsh-jev-verifier/README.md) supplies lessons and candidate code, not the new project's architecture.

[简体中文](README.zh.md)
