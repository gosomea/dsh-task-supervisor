---
title: "V2 batches two and three: integrated validation"
description: "Isolated checks of DAG execution, in-turn observation, image evidence, persistent consultation, and native workers."
status: "verified"
date: "2026-09-27"
---

# V2 batches two and three: integrated validation

## Scope and environment

Batches two and three of the [implementation proposal](supervisor-experience-v2.md) were implemented together before real-model acceptance. This report establishes working plugin mechanisms. Formal long-horizon comparisons remain subject to the [evaluation protocol](evaluation.md).

- Reused registered deployment `supervisor-v2`: port 59909, profile `supervisor-v2`, home `${TMPDIR}/dsh-supervisor-v2-ipco8jot/home`, and copied plugin in the sibling `plugin` directory. The source checkout is `deepseek-harness-supervisor-seam`.
- Retained `supervisor-user` (31973, PID 94963). The daily instance (3080, PID 11374, `~/.dsh`) was not restarted; its profile and served bundles were not changed. The latest isolated build is `566069f`, PID 26276. These process IDs describe this acceptance snapshot, not a future process-control target.
- Main Agent, reviewers, workers, and consultation selected `deepseek-codebuddy/deepseek-v4.1-flash` through the local 15721 `/tencent/v1` route. Actual responses identified `deepseek-v4.1-flash-ioa`. This is the skill's prescribed first CodeBuddy model. The inspected daily new-session default had changed to `minimax-m3`; this run does not establish parity with that default, and did not modify daily settings.
- Native workspace/session APIs bound automatically prepared TMP workspaces; recorded Session cwd matched each binding. Cases share one Host. Cases needing fresh fixtures use separate TMP directories; the image regression reuses the read-only fixture workspace. Registry entries retain case purpose, paths, and Session IDs.
- The browser authenticated using the current Host startup URL. Its token stays in a private local log, outside Git and this report. A fresh browser still needs authentication before using the bare port URL.

## Checks and real cases

| Check | Observed result | Scope |
| --- | --- | --- |
| Kernel regression | 52 checks in seven files passed, including no next model step after a failed worker and ordinary user questions after idle | State, cancellation, revisions, ownership gates; not model judgment quality |
| Strict types | Host and Web client passed separately | Compatibility against actual Host source interfaces |
| Build and package | Node 24 built both bundles; package contained six required files | Runtime entries and package contents; installed by source `link:`, not from a published registry release |
| DAG integration | Independent A/B roots → C join, three nodes accepted and task completed | Dependency gates, node/final reviews, UI projection |
| Persistent consultation | Ordinary questions did not change task revision; typed approve/pause/resume persisted received/applied receipts | Query/control separation through the same controller |
| Compaction and restart | Native command compacted 46 messages, approximately 40022 tokens; subsequent questions retained the binding | Native Session/compaction reuse; main execution still required manual resume |
| In-turn observation | Default 24-result threshold triggered progress review at cutoff 112 | Observation within a long turn; pass did not prematurely accept the node |
| Native images | Both node and final reviewers read image event 40 and recognized red | Real model image delivery, not complex visual quality scoring |
| Native worker writes | Final regression results below | Worker-owned writes, main integration, independent review |

Commands run with Node 24, from the plugin source directory for the first two:

```sh
DSH_SOURCE=/absolute/path/deepseek-harness-supervisor-seam node spikes/kernel/run.mjs
DSH_SOURCE=/absolute/path/deepseek-harness-supervisor-seam node spikes/kernel/typecheck.mjs
pnpm --dir /absolute/path/isolated-plugin build
```

Only the isolated copy was built, preserving lib artifacts served by the older user-validation deployment.

### DAG, consultation, and recovery

Main Session `session-f697363e-74f6-4441-8ddc-e1471e5321ac`, task `0f076531-b98a-44b2-bc26-33fe723a39f2`, workspace `dsh-v2-dag-r_j2c74t`: final phase `complete`, revision 23, plan version 3. Node acceptances are events 209/227/260; the completion review uses cutoff 278.

Consultation is bound to `task-chat-session-f697363e-74f6-4441-8ddc-e1471e5321ac-0f076531-b98a-44b2-bc26-33fe723a39f2`. An ordinary question during review left it running; an explicit pause stopped it. Manual recovery preserved settled worker attempts and evidence cutoffs, and repeated only the interrupted review. After native compaction, a three-sentence question still identified the current node, review progress, and pending work without invoking execution controls.

Outside the main Session, nine Node artifact tests passed. An additional sweep checked 2501 integer-cent formatting inputs from -1250 to 1250, invalid inputs, composed output, and an exact four-file inventory. These are controlled small-task checks, not held-out benchmark scores.

The browser separated main-Agent submissions from Supervisor findings. The sidebar DAG showed A/B → C and three accepted nodes. With the sidebar closed, the main conversation's task disclosure retained the same graph and node details.

![Real isolated Session with DAG and independent review](assets/v2-dag-complete.png)

### In-turn observation and images

Session `session-9a0cc586-f3e1-4821-88fd-b9546b8b0b4b` read 25 text fixtures and a red 64×64 PNG in `dsh-v2-evidence-fn_c50a4`. Default observation ran and continued the same node. The old image tool then lacked its `llm` injection, so review returned `needs-user` rather than completing. This run is retained as a failure sample.

After repair, independent regression Session `session-f8387158-d710-4e52-b41c-d4038972454f` reused that read-only directory. Main `read_image` output is event 40. Node and final reviewers each called the native image reader, persisted `imageSeqs=[40]`, and identified red. Final phase is `complete`, revision 8. Attachment SHA-256: `1a408b8566731a5d50bca8e0d267f26e89a08c88bf9db8b1fac73afaf2da39dc`. All 26 fixture hashes were unchanged afterward.

### Native worker write regression

Session `session-41b47ae7-a4e5-414b-8a9f-83da1607d628`, task `616fd404-100b-43f2-9163-11463e437487`, workspace `dsh-v2-workers-kdmm8gh2`. Two roots own exactly `a.txt` and `b.txt`, respectively, and must write single characters A/B themselves. The main Agent may not write for them; after both settle it runs a read-only Node assertion, submits individual reviews, then requests completion.

Attempt two completed on `566069f`: final phase `complete`, revision 17. Workers were `task-node-a897b5d5-bf0d-448d-b1f7-ed505fb63720` and `task-node-a55c2a4a-bbd7-4e1f-8f78-084835e391bf`. Their native turns overlapped for approximately 14 seconds. Each called write at its seq 24, succeeded at seq 25, and completed normally at seq 37. Files remained from the first attempt: native tools required a read before overwrite, and both workers read then retried successfully without bypassing the constraint.

Main seq 152 dispatched both; seq 155 returned both reports. Seq 159/160 is the successful read-only Node integration assertion; nodes passed at seq 166/179 and completion review passed with cutoff 196. The full main log has no write/edit calls; bash only inspects and asserts. External verification again passed exact contents a.txt=A, b.txt=B and the two-file inventory. This successful real run used the dedicated report tool; normal final-text compatibility and empty-report convergence are separately covered by the deterministic native-host regression.

![Two native workers completed with independent acceptance](assets/v2-workers-complete.png)

## First failures and repairs

| Initial failure | Repair and evidence |
| --- | --- |
| Three requested nodes became five; user requirements were mislabeled implementation choices and review missed it | `7943d15` clarifies accepted dependencies, verification before acceptance, requested node counts and provenance. Replanning the unchanged objective yielded three nodes. The first false pass is not counted as acceptance. |
| Resuming an interrupted review discarded settled worker evidence | `939d1d3` preserves completed attempts/cutoffs and repeats only review. Kernel and real pause/restart/resume checks passed. |
| Web filesystem tools were scoped to the parent Agent, absent from the global worker catalog | `b396779` registers restricted definitions from the parent's native view and mirrors Web scoping in tests. Main-Agent fallback writes in the initial billing run are not worker-write success. |
| Native image tool lacked a Cordis injection | `b396779` declares `llm`; the independent real image regression passed. |
| Normal worker final text was treated as a missing report | `ff4c3bc` uses DSH `finalAssistantOutput` for normally completed, nonempty text; integration and independent acceptance remain mandatory. |
| Main Agent retried tools after worker failure paused the task | A stronger regression exposed that failed tools cannot carry concludeTurn. `566069f` rejects the failed turn at native pre-step, releases the guard at idle, and allows later user questions. All 52 checks passed. |
| Consultation profile lacked native compact; the model claimed plain text had compacted history | Enabled native compaction-basic/command-compact in the isolated profile and selected the actual command menu. Native compaction records prove success; plain-text replies do not. |

## Limits and subsequent acceptance

- These are controlled small tasks and mechanism combinations. The complete shrine project has not been rerun; no superiority over Goal, Plan, or Lead–Worker Team is established. Full shrine regression, independent held-out tasks, and paired evaluation remain pending.
- Workers share the workspace and write exact owned files through native filesystem tools. Arbitrary shell is unavailable; the main Agent performs tests/builds/integration. Separate worktrees and broader worker tools remain future work.
- Plugin-bound evidence tools read child Sessions. These specialist workers/reviewers are not registered in the generic DSH subagent catalog; generic child Session pages may report an unavailable descriptor. Bound review reads work, while standalone child browsing still needs integration.
- Image acceptance covers delivery and simple color recognition. Browser semantic quality, complex 3D scenes, and animation require dedicated cases.
- Ordinary consultation was verified not to control the task. Explicit intervention recognizes a limited set of direct commands, not arbitrary natural-language authorization.
- Raw model reasoning and native compaction summaries can still be English. User-visible task reports, independent findings, and consultation responses were verified in Chinese.
- The prototype depends on a persistence seam that is not a public standard DSH interface; this isolated acceptance does not establish installation compatibility with arbitrary releases.

[简体中文](v2-integrated-validation.zh.md)
