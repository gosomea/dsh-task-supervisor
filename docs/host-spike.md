# Kernel capability experiment

This reference records the **initial** bounded experiment in [spikes/kernel](../spikes/kernel/). It uses actual DSH Agent, loop, command, tool, Session, and JSONL persistence services, with scripted model responses. The gap and next steps below describe that experiment at the time; the later [implementation status](implementation.md) records the host extension, installed plugin, and Web smoke test. Neither test establishes real model review quality.

## Results

The experiment was run on 2026-09-24 against local DSH commit `00102833dfaee1da9f48a3a8eae9d34005a75218`, reporting package version `0.1.7-alpha.2`, using Node 24. The ten assertions pass, including an assertion that reproduces a storage refusal; passing that regression does not mean persistence is ready.

| Experiment | Observation | Limit |
| --- | --- | --- |
| Independent command and tool | `/task` executes without a model request; a scoped task tool runs through the real loop. No Goal, Plan, or Team service is mounted. | Command collision, dedicated preset composition, and native-workflow coexistence remain untested. |
| Hold and review | The main agent is held before its second step; a separate agent calls a tool bound to a captured main-session prefix; releasing review allows exactly one next request. | The reviewer is created directly through the Agent service with scripted output. The production subagent provider, pagination, and redaction are not exercised. |
| Cancel a held step | Cancellation settles the held main agent; a later review release produces no additional model request. | Cancellation of an actively streaming reviewer and complete Supervisor shutdown remain untested. |
| Wake with recorded source | Passive injection leaves an idle agent idle; `followup` wakes it; both accepted inputs retain the plugin source in `user/message`. | This does not implement revision reservation, user-edit priority, or duplicate admission protection. |
| External event through live Session | `Session.append()` accepts the plugin event, and the persistence handle writes it. Reopening the stored session rejects its unknown required event type. | This is a reproduced blocker for the proposed live event path. |
| Explicit envelope at storage level | Adding `ignorable: true` to a copied event before a lower-level persistence append permits it to round-trip. | This is diagnostic only. It bypasses live Session publication and does not establish that ignoring task-control state is safe. |
| Recovered pending work | A recovered Agent stays idle, but a later human message wakes the old queued supervisor continuation before the human input. | A paused display alone cannot prevent stale work. |
| Recovery with the controller present | An `agent/created` listener removes only owned stale messages, flushes, and preserves pending human input. | This does not cover a missing controller, process-kill recovery, or every queue race. |
| Pending model selection | Default child inheritance uses the last request model even after a new `model/selection` record; an explicit route selects the new model. | [Reviewer model policy](review-model.md) requires an effective-selection reader; real provider routing remains untested. |
| Continuation after durability | A followup queued inside `runMaintenance` remains unexecuted after `flush`, while a separate read handle sees the inbox record; releasing maintenance starts the request. | Covers idle admission, not write failures, concurrent edits, or a real process crash. |

## Persistence gap

The [public Session append method](../../../deepseek-harness/packages/core/session/src/index.ts) accepts event data and applicable model-surface options, but does not expose the envelope's `ignorable` marker. The [known event list](../../../deepseek-harness/packages/core/session/src/known-event-types.ts) is generated from DSH's own source and excludes an external plugin by construction. The [stored-event validator](../../../deepseek-harness/packages/session/session-persistence/src/storage-contract.ts) refuses an unknown event without that marker when reopening the log.

The test declares `supervisor-spike/state`, appends it through a live Session, writes the event through the real persistence service, and asserts the refusal when reopening. TypeScript declaration merging alone cannot alter this runtime admission rule. The stored log is not repaired or rewritten to make the test pass.

The lower-level positive control proves that the envelope can survive storage. It is not an approved implementation path: a second writer would bypass the live event stream, its projections, and the loop's persistence ownership. The project therefore does not adopt direct log rewriting, a second authoritative JSON history, or a mutation of the host's generated known-event set.

The next integration decision must cover two obligations together: a supported way to publish external plugin records through the live Session, and what happens when the controller is absent or cannot understand the record version. A candidate extension exposing envelope metadata is insufficient by itself. Calling control records ignorable requires evidence that no supervised continuation can resume without its controller. A host change, if needed, should address general plugin persistence rather than depend on native Goal or Plan services. [Supervisor Session design](session-runtime.md) now recommends a general plugin-record and execution-admission extension; it remains unimplemented.

## Reproduce

Use an installed DSH checkout with its development dependencies and existing project-reference declarations. Node must satisfy that checkout's engines. The default source location is the sibling `../../deepseek-harness` relative to this project; set `DSH_SOURCE` to use another checkout.

```sh
node spikes/kernel/run.mjs --reporter=verbose
node spikes/kernel/typecheck.mjs
git diff --check
```

Run these commands from this project. The test runner resolves DSH packages to their source through the checkout's path map and applies its standard decorator transform. The strict typecheck uses the checkout's host options and declared project references; it does not rebuild dependency artifacts or claim to typecheck the whole DSH repository. Runner and Vite configuration are test utilities, not application launchers.

## Isolation and remaining work

The experiment mounts no application profile or network listener and makes no real model request. JSONL stores are created in fresh temporary directories and removed after their contexts are disposed. It does not use the daily DSH home or rebuild the daily checkout. The observed daily listeners on 3080 and 3081 retain their original PIDs after the experiment; no claim is made about unrelated user activity during that interval.

The initial experiment left `dsh plugin add link:` installation, dedicated preset composition, initial-plan tool restrictions, durable task projection and revision checks, process restart followed by manual resume, owned reviewer cancellation, the right-hand panel, and the service fixture's independent acceptance for future work. See [implementation status](implementation.md) for which of these now have evidence. The independent executable fixture and comparative evaluation remain open.
