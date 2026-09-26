# Implementation status

This page describes the runnable prototype as of 2026-09-24. The other design pages describe the intended product, including behavior that this build has not implemented.

## Native integration

The Host entry point is [`src/index.ts`](../src/index.ts). It registers `/task`, four model tools, lifecycle listeners, a tool execution guard, and an optional Web route. The Web client is [`src/client/index.tsx`](../src/client/index.tsx): it mounts into DSH's right sidebar tab and reads or controls the bound task through Connection's authenticated `/api/task-supervisor` Fetch route. The route has no separate listening port and returns state derived from the Session. A closed Session can be read in bounded persistence pages; control actions require a live Agent.

The task record lives in the main DSH Session as `extension/record` events. [`src/state.ts`](../src/state.ts) validates and folds one full snapshot per transition. Reviewers have their own native child Sessions; the main record stores the reviewer Session ID, selected model, evidence seqs, and fixed main log cutoff. The reviewer gets `read_task_evidence`, which is bound to that main Session, returns at most 30 events per page, limits text, and redacts common key patterns. A tool guard denies other reviewer tools. Main Session text is evidence, never reviewer instructions.

The companion Host change lives in an isolated `deepseek-harness-supervisor-seam` worktree. It adds one known log-only `extension/record` event and an effect-scoped `registerSessionControlReader(namespace, versions)` admission check on resume and before a step claims inbox input. A Session that needs an absent or incompatible reader refuses execution. This is a required DSH dependency, not yet a released public seam; the standard DSH build cannot run this prototype safely.

## Control behavior

The initial plan needs one explicit approval. While approval is pending, the main Agent may call `task_submit_plan` again to replace the entire pending plan; approval always applies to the latest plan version. Planning tool access is enforced at the executor. Later `/task edit` invalidates the prior plan and asks the main Agent to submit a full revision, without a second approval. Approved work continues after each idle turn. `maxAutomaticRoundsWithoutReport` defaults to three; at that interval a fresh progress reviewer decides to continue, revise, or request a user decision. Stage reports and final completion requests each get a fresh review. A final `pass` is the only transition to `complete`.

State and queued Supervisor messages are flushed before waking the Agent. On restart, the task projection is restored, stale Supervisor messages are removed, and execution remains disarmed until `/task resume` or its panel button. An interrupted review keeps its submitted evidence in the durable state; manual resume asks the main Agent to verify current effects and resubmit the review. `/task off` cancels owned work and leaves the task record; `/task on` does not rearm it. Human input is not removed by the Supervisor's stale-message cleanup.

## Verification performed

- Strict DSH Host typecheck and two focused Host tests passed, including refusal on resume without a compatible reader and refusal after reader removal before the next step.
- Sixteen scripted tests against real DSH services passed. The six Supervisor integration tests cover plan approval guard, persistent manual recovery, automatic continuation after a passing progress review and pause for user input, interrupted review recovery, off/on behavior, stage review, and final completion. Scripted model output proves control wiring and safety gates, not review quality.
- The Host worktree's `doc-sync` gate passed all 42 checks. Its new persistence event has a bilingual same-version change record.
- A Node 24 package build and `pnpm pack --dry-run` included the Host bundle patch and Web client. In a separate `DSH_HOME`, DSH's `plugin add link:` installed the package and `--dump-config` showed the enabled row.
- An isolated DSH Web Host mounted the client. A task created through the real composer appeared in the right panel; the panel's **Close Supervisor** and reenable controls changed the native Session state; after Host restart the task reappeared with a manual **Resume task** control. The isolated profile had no model credential, so this Web run did not exercise real model judgment.

## Current limits

The prototype holds one task per Session. It has no `/task plan` shortcut, five-task queue, fork protocol, configurable user-decision timeout, independent executable artifact acceptance, or measured long-horizon advantage over Goal, Plan, or Team. A reviewer can cite Session evidence and judge completion, but its model decision is not the separate executable acceptance benchmark described in the design. Real model quality, cancellation during an in-flight remote request, Web control across every Session lifecycle, and a complete coding fixture still need validation. The isolated Host extension and plugin changes are local until reviewed and merged or published.

[简体中文](implementation.zh.md)
