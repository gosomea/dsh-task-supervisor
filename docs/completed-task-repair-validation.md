# Completed-task repair validation

2026-09-28, independent-verification enhancement step 1. This validates the reopening implementation in this commit. Steps 2–5—independent snapshots, runners, two-phase review and real user journeys—remain pending.

## Environment and model

Reused the `supervisor-rework` environment registered by `dsh-plugin-isolated-test`: Web port 61454, profile `supervisor-v2`, separate DSH_HOME and candidate plugin directory. Existing native services came from `deepseek-harness-supervisor-seam`; shared DSH core and client artifacts were not rebuilt. Native RPC created and bound a fresh TMP workspace without a folder picker. User instance 59909, its long-running task and the frozen P2 public evaluation were not replaced.

The main model and all seven reviews used `deepseek-codebuddy/deepseek-v4.1-flash` through the isolated profile route. Main Session: `session-7e2da4aa-43f4-4ff0-8b5d-407d17519ff5`; task: `e6272b0b-7e51-4fb2-af3e-c8b6ec46948e`. Authentication URLs, credentials and raw logs remain private.

## Deterministic checks

| Check | Result and scope |
| --- | --- |
| `DSH_SOURCE=<seam> node spikes/kernel/run.mjs` | All 101 tests across 11 files pass, including native Host, projection, client requests and history restoration. |
| `DSH_SOURCE=<seam> node spikes/kernel/typecheck.mjs` | Host and client strict checks pass, including fixtures. |
| Candidate `pnpm run build` | Both bundles build; only isolated candidate artifacts change. |
| Candidate `pnpm pack --pack-destination <private-check-dir>` | Six declared package entries/files are present, without test state or credentials. This is packaging inspection, not publication. |
| Six focused checks after fixture resource cleanup | All pass. TMP allocations register immediately; Context disposal settles before removal. |

Coverage includes unconfirmed execution refusal, a rejected real write tool, absence of model confirmation tools, unioned impact with shared descendants reset once, retained unrelated passes, exact revisions and artifacts, explicit symlink/limit failures, occupied admission slots, idempotency, historical restoration, rejection of fabricated transitions without receipts, and manual resume after restart. Persistent consultation proposals record source and proposer without becoming implementation instructions.

Filesystem fixtures own their TMP roots, Contexts and scripted models. HTTP fixtures invoke the registered Fetch handler without binding a real port. The symlink fixture explicitly skips Windows pending separate privilege validation. This run used macOS.

## Real models, clicks and independent commands

The objective exports integer addition in `add.mjs` without changing the externally supplied `public.test.mjs`. The operator injected two one-line regressions after completion to exercise authorization. This is a control-flow case, not a measurement of reviewer defect detection or public success rates.

| Cycle | Native records | Independent result |
| --- | --- | --- |
| 1 | Browser approves initial plan; completion seq 103, revision 9, attempt 1 | External `node public.test.mjs`: `PASS 3 sum cases`. |
| 2 | Operator replaces addition with subtraction; proposal seq 198; restart preserves pending proposal and unchanged file; browser confirmation seq 203; write seq 224; completion seq 262, revision 16, attempt 2 | Same external test passes; same task and plan v1 retained, one historical reopening. |
| 3 | Operator replaces addition with multiplication; read-only diagnosis and Chinese main answer; proposal seq 298; browser confirmation seq 305; write seq 326; completion seq 364, revision 23, attempt 3 | Same external test passes; same identity and plan retained, two historical reopenings. |

The main log contains writes only at seq 58, 224 and 326. Both repair writes follow the corresponding click receipts. Pending proposals contain no implementation writes, and independent file reads confirm the injected defect remains. See the [safe event index](completed-task-repair-evidence.json).

An early candidate forcibly ended the model turn after proposal submission and produced an empty main answer. Removing that forced conclusion lets the main Agent summarize natively. The third-cycle proposal produced a normal Chinese Markdown diagnosis, scope and confirmation notice; the plugin did not copy or rewrite it. The earlier proposal lacks source metadata and acquires no invented attribution; the later proposal records `main-agent` and its Session ID.

![Native main answer, compact task entry and repair impact sidebar](images/completed-task-repair-impact.png)

## Conclusion and limits

Same-objective defects can now return to the original task and DAG through explicit clicks while retaining earlier acceptance. Repair text cannot substitute for click authorization. The registered isolated 61454 deployment and case remain available.

This real-model case has one node. Native deterministic fixtures cover multiple roots, descendant unions and historical task restoration; these were not separately reproduced with real models here. Workspace identity binds proposal to click, not an immutable acceptance snapshot. Independent read-only shell isolation and concurrent external-write policy remain runner work. Existing review examines main-Session evidence and gains no code-execution tools in this step. These results do not establish superiority over Goal or Plan on long tasks.

[Repair protocol](completed-task-repair.md) · [Enhancement plan](10-plans/independent-verification/plans.md) · [简体中文](completed-task-repair-validation.zh.md)
