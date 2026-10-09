# 2026-10-09 long-horizon public comparison: frozen batch

DeepSWE v1.1 is pinned to `0b9fabbb63b9104d678fe965e1632f2dd9eaa2ea`. Four undelivered candidates comprise two Go tasks (updo-policy-alerting and geo-shapeindex-serialization) and two TypeScript tasks (superjson-error-stack-serialization and koota-pair-relation-tracking). Goal, Plan and Supervisor-independent each repeat twice: **24 positions**. Formal delivery at creation is **0/24**; development fixture rewards are not official results for this batch.

## Frozen material

- [release.json](release.json): safe runtime projection, artifact/source identity, dependency index digest and admission evidence digests.
- [order.json](order.json): the original seed order `dsh-opensandbox-long-horizon-v1`; the first position is geo / Plan / r2. The subsequent user-requested execution order is [execution-order-v5.json](execution-order-v5.json).
- [admission.json](admission.json): four actual permission, untracked-snapshot, offline independent-command and mount-free baseline gates; official empty=0/reference=1 controls; real main/reviewer route proof. Model-free admission failures and repairs remain recorded.
- [Frozen tarball](artifacts/dsh-task-supervisor-frozen.tgz): SHA-256 `cdd051964e75b930c80341b3be1fc9421996d24f23fc67d0a8ba6c36439ee366`. Plugin source `44b2a42`; monitoring and usage convention `2796533`.

The internal package version is still 0.1.4, but this is an explicitly frozen experimental artifact. Published npm 0.1.4 is not a replacement. Verify SHA-256, then use `dsh plugin add /absolute/path/dsh-task-supervisor-frozen.tgz`. All four installation gates used identical bytes. This batch neither publishes npm nor replaces daily 3080.

The private release retains the complete file index, log locations and runtime configuration in the registered environment, without publishing credentials, authentication URLs or grading material. A model-free v1 release was superseded before delivery only to correct user-action counting; its records remain and no Agent was redelivered.

## Fixed protocol

Original task text, the same daily CodeBuddy deepseek-v4.1-flash route and frozen reasoning/tool settings are used. Every position has a separate Session and clean baseline; runs are serial. The official 10800-second budget starts at startup and includes planning, approval, review, retries and continuation; official grading has a separate 1800-second limit. Formal tasks permit only one protocol initial approval, without injection, revision, extra prompts, evaluator commits or automatic pause recovery.

Execution receives 2 CPU/8 GiB, independent checking 2 CPU/8 GiB and administrator 1 CPU/1 GiB. Admission samples actual capacity of 5 CPU/17 GiB, 30 GiB free Docker disk and 8 GiB free host disk. Main writable storage of 20 GiB and private checks of 4 GiB use 60-second sampled stops, **not hard quotas**. Go caches are prewarmed without models or network; changed inputs still recompile under ordinary cache rules. Execution has no Docker socket; checking has no grading material or source workspace write access.

Python is the only outer controller; the plugin owns bounded recovery and scheduling. Started positions reconnect rather than redeliver; final files use exclusive creation. Ordinary product failure continues to the next position. Proven runner/resource/scoring faults stop new delivery with original evidence and deviations retained. Only Agent-committed base..HEAD patches enter official grading; dirty artifacts are diagnostic.

## Metrics and limits

The full 24-position denominator includes undelivered positions and reasons. Infrastructure/scoring faults are not converted to product reward zero. Strict success requires timely controller completion, official reward=1 and no infrastructure/scoring exception. User actions include the original instruction and explicit grants; native Goal creation does not double-count instruction submission. Earlier development revision counts are not rewritten as formal scores.

Missing Session usage yields null total tokens with reported lower bounds. Unmeasured check CPU time is null. Unlabelled false acceptance, false pause and correction benefit remain null; mechanically observable announced-complete-but-official-failure is separate. Paired uncertainty uses four task clusters, not repeats as additional independent tasks. Long time limits alone do not demonstrate long-horizon advantage.

See [development validation](../validation-20261009.md) for gates and preserved failures, and the [protocol](../protocol.md) for roles and authorization. Formal evidence is appended after collection and grading; existing results are never overwritten.

Ongoing progress is retained in [immutable result snapshots](reports/); execution inputs remain frozen.

Report-only postprocessing also counts actual turns, model steps, tool calls/errors, context compactions and nodes of the bound Supervisor Task from original collected Session logs. It selects the highest actual log generation and follows durable parentSession lineage. Missing bindings or legacy records without nodeRuns do not gain invented node/attempt data. The sum of current node attempt ordinals includes pending nodes and is not an implementation count. This reads collected material without rewriting frozen inputs or original results; native Goal/Plan node semantics are not equated with Supervisor nodes.

Reports also retain counts of the actual `turn/end` event's `data.reason.kind`, including truncated model generation, normal completion and unclassified legacy records. These do not replace Task terminal state. `max-tokens` is the model response's length stop type; cumulative usage across requests does not establish an exhausted uniform Task token ceiling. Position three, Koota/Plan, ended its first turn with `max-tokens` before requesting plan approval or committing implementation. Official grading ran its empty patch and returned reward=0 (F2P 0/38, P2P 172/172). Position four, Geo/Plan, likewise stopped its first planning turn on generation truncation and scored its empty patch reward=0 (F2P 0/24, P2P 599/599). These product stops received no rescue or Agent reruns; execution continued in the fixed order.

## Post-freeze monitor repair

The first Plan position exhausted native request retries (transport failure followed by upstream 502). Its error turn ended without queued continuation, but the original monitor did not classify this state. New delivery was stopped with the original Session retained. A separately frozen monitor repair recognizes the same settled request-fault event in two observations before infrastructure sealing; it sends no rescue prompt and grants no permission. The original release, position and deadline remain recorded. This deviation is reported separately from product failure; no Agent rerun replaces the position.

Route recalibration passed real main/reviewer HTTP plus durable answer joins. Its first isolated installation failed DNS resolution before any model request; a verified host-resolved IPv4 binding for `registry.npmjs.org` restored bootstrap. The repair freeze supplies this explicit mapping to subsequent positions before installation, without changing package versions, native permissions, model routing or original task text. The first sealed position keeps its original specification and result digest; the new controller may acknowledge that exact prior fault and proceed, but must stop on any new infrastructure/scoring fault.

The third repair freeze is [repair-v3.json](repair-v3.json), with 68 Python regressions passed. Route calibration is not task acceptance and its review was stopped after request proof. Original v2 and the first result remain immutable.

During implementation of position two, controlled state replay exposed another runner predicate gap: an approved Plan's earlier response could mask a current request failure or imply completion while native Inbox continuation remained queued. Finish evidence now requires the current `turn/end.completed`, matching turn identities and empty queues. A settled request failure cannot be overridden by an earlier completion hint and still needs two observations. This changes no DSH Plan, Agent or permission behavior. The local monitor stopped new delivery while the original second Agent, Session, approval and deadline were retained. All 73 Python regressions passed; actual original-Agent progress during repair was verified. The repaired freeze reconnects that position without redelivering its task.

That monitor repair is frozen in [repair-v4.json](repair-v4.json), from runner source `bc45ef6`. At repair time, all 24 specifications, package bytes, route and execution order were unchanged. Position two reconnected its original Session and reached collection/grading after valid normal-finish evidence. Its original initial-grant receipt remains the only grant. This predicate repair is a separate protocol deviation; earlier releases and results are not overwritten.

Subsequent public snapshots retain native completion event sequence, turn, timestamp and controller source digest in `terminal.nativeCompletionEvidence`, without event bodies. Report export does not modify the frozen runner or original results. Controller completion and official reward remain separate outcomes.

## User-requested Supervisor priority

The seed order happened to put five Plan positions first. With five delivered and four sealed, the user requested prioritizing Supervisor evaluation. That order change is frozen in [supervisor-priority-v5.json](supervisor-priority-v5.json), with [execution-order-v5.json](execution-order-v5.json): preserve the five started positions, execute all eight undelivered Supervisor-independent positions in their original relative order, then complete the remaining Goal/Plan positions in their original relative order.

Position IDs, four tasks, eight positions per condition and the full 24-position denominator remain. All 24 specification files and runner files were verified byte-for-byte unchanged; package, model, budgets, authorization and grading rules also remain. Digests of 25 existing start, delivery, grant and sealed-result records were verified. Only the local monitor was handed off; position five retains its original Agent, Session, deadline and single grant, without stopping or redelivering the Agent.

This is a user-requested execution-priority deviation, not another product-fault repair. The seed order and previous releases remain intact; new snapshots bind the actual execution-order digest. The final report must disclose possible confounding between condition and execution time. It cannot describe the batch as fully seed-ordered or treat early Supervisor results as the completed comparison.

## Native Task command identity repair

Position five, Updo/Plan, completed normally and ran official grading: reward=0, F2P 16/17 and P2P 123/123. Only the Agent's committed 65,802-byte patch was submitted. Controller completion and full official acceptance remain separate; no failing-test hints are sent to later Agents.

Position six was the first Supervisor run. Its instruction file ends with a newline, while native `/task` applies `trim()`. The monitor compared the resulting objective directly against the raw-file digest, raised `ValueError` during planning and stopped/collected the run. Original logs prove that only the final newline was removed. This remains a runner infrastructure fault with reward=null. No independent review or official grading ran, so this is not evidence of Supervisor verification quality.

The current runner freeze is [repair-v6.json](repair-v6.json), source `f328155`, preserving v5's Supervisor priority. New start records retain both raw-instruction and native-objective digests with an explicit ECMAScript trim rule. Content or interior-format changes still reject; legacy records keep their previous protocol. All 38 focused regressions passed. Original-log replay reproduced the old rejection and verified corrected binding without granting approval; seven inputs matched actual Node `trim()`. All 24 specifications and the original package remain unchanged, 32 existing record digests were verified, and fault resources were actually released. The freeze acknowledges only the exact previous fault result, without redelivering position six. Any new infrastructure or scoring fault still stops later delivery.

Position seven, Koota/Supervisor, has [bound its actual original instruction](live-identity-confirmation-v6.json). Its first [planning observation review](supervisor-first-review-v6.json) was validly applied at native event seq 121, after which the main Agent continued planning without an initial grant or rescue. This checkpoint uses log review. Independent artifact checks and final official grading still require actual completion; this does not establish whole-task acceptance.

## Environment handoff and resumption

Execution uses the registered `colima-dsh-eval-rosetta` Docker context and OpenSandbox at `localhost:8090`. Frozen materials identify DSH, model routing, images, runner, package and grader; do not select newer dependencies online. Daily port 3080 is outside this batch's resources.

Read the frozen release/order, batch owner events and position records, then verify the actual process's complete command line and original sandbox. A lock file or old PID alone is not liveness evidence. Observe an active owner without launching another monitor. After the original owner has stopped, resume with the same private release and runs directories:

```sh
<SDK Python> <release>/runner/sandbox-run/batch.py <release> <runs> --python <SDK Python> --domain localhost:8090
```

`<release>` must be the complete digest-verified freeze; the public redacted `release.json` cannot replace private execution configuration. The command validates files, service identity and an exclusive lease, then selects the next operation from durable records:

| Existing record | Next operation |
|---|---|
| `started.json`, no terminal | Reconnect the original sandbox/Session and observe; never redeliver the Agent |
| `terminal.json`, collection incomplete | Resume original collection after stopping and resource convergence |
| `collection-complete.json`, no result | Resume separate grading of the original Agent's committed patch |
| `result.json` | Sealed and read-only; continue the fixed order |
| Only `delivery-intent.json`, delivery uncertain | Reconcile the original request and Session; never create a replacement position |

`terminal.json` records a stopping condition; `collection-complete.json` records completed artifact/log collection; only `result.json` counts as sealed. Reconcile original actions when admission, collection, resource or grading faults occur. Do not delete records or append `resume` to force progress. A repair needs a separate freeze and reported protocol deviation; delivered specifications and sealed results remain unchanged.

The committed `public_results.py` reads original results and collected logs into a new non-overwritable output directory. Report processing may have a different version from frozen execution; record that distinction without changing inputs, grants or official rewards. Keep private logs, model text, credentials and grading materials in the registered environment. Publish only redacted counters and evidence digests.
