# Evaluation design and execution roadmap

Current work follows the [OpenSandbox long-horizon protocol](../eval/sandbox-run/protocol.md): four holdouts, three conditions, two repetitions, 24 positions. Revision development passed; strict fault recovery and final freezing remain under validation, with 0/24 formal deliveries. Historical batches below retain their original dates and definitions and are not pooled with this batch.

**Updated: 2026-09-28. Status: three arms are sealed on two frozen tasks; a third task passed the environment gate.** This document owns evaluation questions, execution order, datasets, comparison arms, metrics, and result deliverables. See the [SWE-bench Pro V2 record](../eval/swebench-pro-v2/README.zh.md), [NodeBB calibration](../eval/swebench-pro-v2/calibration-nodebb-20260928.zh.md), [frozen NodeBB results](../eval/swebench-pro-v2/frozen-nodebb-20260928.zh.md), and [frozen Navidrome results](../eval/swebench-pro-v2/frozen-navidrome-20260928.zh.md). There is no sample sufficient to estimate overall success, long-horizon holdout, or superiority claim; [architecture](architecture.md) owns product design and [implementation status](implementation.md) records working capabilities.

See [step F](10-plans/conversation-and-review-recovery/evidence/f.md) for the new development regression and audit, and the [frozen frequency protocol](../eval/review-recovery/frequency-p2-protocol.md) for follow-up conditions. Original frozen outcomes remain unchanged; the frozen frequency comparison has started, with 6/60 sealed results at 19:48 on 2026-09-28 in the [dated check](../eval/review-recovery/p2-20260928/progress-20260928-1948.zh.md). Enhanced independent verification uses a separate protocol and batch.

## Summary

The study asks whether Supervisor completes tasks that follow user instructions and pass independent acceptance more often than native DSH Goal or Plan, and sustains that ability over long execution.

First establish reproducible native DSH Goal, native Plan, and Task Supervisor baselines on public benchmarks, collecting independent acceptance, completion judgment, intervention, and resource measures from the first run. Evaluate multiple consecutive Tasks, Plans, or Goals in one Session after public benchmark execution is stable and a comparison report exists. Existing custom cases remain regressions rather than the first primary benchmark; a multi-task Session runner does not block public benchmark integration.

## Table of Contents

- [Execution order](#execution-order)
- [Public dataset selection](#public-dataset-selection)
- [Initial comparison protocol](#initial-comparison-protocol)
- [Comparison and evidence rules](#comparison-and-evidence-rules)
- [Evaluation layers and development regressions](#evaluation-layers-and-development-regressions)
- [Required metrics](#required-metrics)
- [Automation and result artifacts](#automation-and-result-artifacts)
- [Later multi-task Sessions](#later-multi-task-sessions)
- [Existing evidence and next actions](#existing-evidence-and-next-actions)
- [Claim threshold](#claim-threshold)
- [Reuse sources](#reuse-sources)
- [Dev Note](#dev-note)

## Execution order

| Priority | Work | Completion condition |
| --- | --- | --- |
| P0 | Select public dataset versions, task lists, and external graders; freeze metrics and baseline interactions | Reproducible environments, expected reference-solution and empty-patch results, identical inputs and normal execution opportunities for all three arms. |
| P1 | Run all three arms end to end on a small public subset | Every attempt has logs, artifacts, independent scores, and metrics; distinguish infrastructure failures from task failures. |
| P2 | Expand public samples, repeat paired runs, and report results | Full denominators, per-task outcomes, failure classes, task-family breakdowns, and uncertainty; reserve samples not used for tuning. |
| P3 | Consecutive Tasks, Plans, or Goals in one Session | Fixed scripts evaluate task switching, lasting constraints, regressions, compaction, and recovery against a fresh-Session-per-task control. |

Start with a suggested 6–12 public integration tasks selected by repository, task type, and difficulty rather than expected wins. This scale diagnoses integration issues; determine formal sample size and repetitions from pilot variance, failures, and available environments, then freeze them before comparative runs. Report official benchmark timeout settings separately from diagnostic runs with relaxed limits.

## Public dataset selection

| Order | Dataset | Purpose and integration scope |
| --- | --- | --- |
| Frozen batch | [SWE-bench Pro V2](https://github.com/scaleapi/SWE-bench_Pro-os/blob/main/v2/README.md) | Real repository tasks with official Harbor task directories, graders, reference solutions, containers, and independent patch regrading. Preserve existing protocols and results. |
| Current long-horizon comparison | [DeepSWE v1.1](https://github.com/datacurve-ai/deep-swe) | The [OpenSandbox batch](../eval/sandbox-run/long-horizon-20261009/README.md) passed admission for four tasks and froze two repeats each of Goal, Plan, and Supervisor-independent: 24 positions. Execution is underway, with each sealed result retained in batch snapshots. The earlier [two-task four-arm pilot](../eval/deepswe/README.md) retains its original protocol and results. |
| Terminal-task candidate | [Terminal-Bench 2.1](https://github.com/apache/maka/blob/main/docs/eval/terminal-bench-2.1-deepseek-v4-flash-nine-arm.md) | Published DSH evidence can inform terminal-task integration; task selection, environments, and the formal protocol require a separate freeze. |
| Consecutive-task candidate | [SlopCodeBench](https://github.com/SprocketLab/slop-code-bench) | Evolving requirements on one project; the official protocol retains the workspace but resets Sessions, so persistent Sessions require a separate protocol. |
| Expansion candidates | [LongCLI-Bench](https://github.com/finyorko/longcli-bench), [LHTB](https://github.com/zli12321/LHTB), [SWE-EVO](https://github.com/SWE-EVO/SWE-EVO) | Validate grading, external continuation, and environment gates before adoption; published leaderboard scores are not this project's controls. |

SWE-bench Pro V2 integration has started. The first reference check failed under QEMU; isolated VZ/Rosetta achieved empty-patch 0 and reference 1, and all three calibration-arm patches earned reward 1.0. NodeBB, Navidrome, and Open Library in the six-task frozen sample passed that gate. NodeBB Goal completed on time with reward 1.0; Plan timed out and Supervisor paused after a review-format fault until timeout. Both deadline patches earned diagnostic reward 1.0 but failed the primary measure. All three Navidrome arms completed on time and passed external grading. Open Library has not received model work in that initial three-arm batch; later P2 execution is recorded in its progress reports. Calibration is excluded from the frozen sample; two frozen tasks cannot establish overall differences. Pin dataset commits or versions, sample IDs, image digests, grader versions, and initial repository commits; inspect licenses and environment requirements before running. SWE-bench Pro V2 documents linux/amd64 images; verify reference and empty patches per task. Do not pool versions or describe altered tasks, interactions, network rules, or time limits as official scores.

Public coding datasets generally organize individual tasks. One task may contain many model interactions and continuations, which does not establish support for consecutive user tasks in one Session. Define that separately in P3; do not force tasks with incompatible repositories or base commits into one workspace.

### Long-horizon benchmark research, 2026-09-28

The sources below are published runs by others and integration recommendations for this project. This project has not run these new candidates; this research does not change tasks, versions, or rescue rules in old P2. Enhanced SWE-bench Pro verification preflight found a NodeBB snapshot entry-limit failure, a Navidrome capture failure on a dangling relative symlink, and no Docker check entry point in the container-hosted runtime. These are snapshot and deployment failures, not evidence that DSH cannot execute the dataset; another container benchmark still requires a check entry point.

| Candidate | Published execution evidence | Value and limitations for this project |
| --- | --- | --- |
| Terminal-Bench 2.1 | [Maka's nine-harness report](https://github.com/apache/maka/blob/main/docs/eval/terminal-bench-2.1-deepseek-v4-flash-nine-arm.md) publishes per-task CSV results for 89 tasks, including DSH at 65/89 with DeepSeek V4 Flash; DSH ran later and some cells were rerun after infrastructure repairs, making the result descriptive. | The most direct DSH integration reference. Its [adapter](https://github.com/apache/maka/blob/main/packages/eval/README.md) uses a JSON-RPC minimal composition, which does not validate this plugin or Goal/Plan. Reuse official grading and validate background-service lifetime, command deadlines, and dependency installation. |
| DeepSWE v1.1 | The [official corpus](https://github.com/datacurve-ai/deep-swe) contains 113 original engineering tasks; [DeepSeek's reproduction instructions](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash/blob/main/evaluation/README.md) provide pinned Pier/corpus revisions and an SDK `dsh-minimal` adapter; [FrontierHarness](https://github.com/frontier-harness-eval/eval/blob/main/benchmark.json) also publishes multiple DSH profile results on 9 DeepSWE and 21 Terminal-Bench tasks. | Recommended engineering track: grade committed patches in pristine separate containers. SDK minimal is not this plugin's preset; public samples and changed network environments do not establish equivalent controls. Apply task resource requirements rather than calling old P2's 1 CPU/4 GiB an official reproduction. |
| SlopCodeBench | The [paper](https://arxiv.org/html/2603.24755v1) reports Claude Code, Codex, and other runs on 20 problems and 93 checkpoints; the current [corpus](https://github.com/gabeorlanski/scb-problems) is separate and requires version pinning. | Closest to multiple Tasks on one project: add requirements while checking prior behavior. The paper uses a new container per checkpoint, retains only the workspace, and resets Agent Sessions; persistent-Session experiments must be reported separately from the official track. |
| LongCLI-Bench | The [paper](https://arxiv.org/html/2602.14337v2) reports three repetitions by Codex, Claude Code, and OpenHands on 20 tasks; its [runner](https://github.com/finyorko/longcli-bench) provides requirement, regression, and step scores. | Measures invalid plans, early stalls, and regressions; a closed [environment/grading defect report](https://github.com/finyorko/longcli-bench/issues/4) requires confirmation of fixed revisions per task. Calibrate QEMU, concurrent tests, and hidden-grader feedback first; no complete public DSH reproduction was found. |
| LHTB | The [paper](https://arxiv.org/abs/2607.08964) releases 46 long terminal tasks with dense rewards; the [repository](https://github.com/zli12321/LHTB) publishes Terminus-2 and other runs, with a standard 90-minute budget. | Supports longer single-task stress tests. On 30/46 tasks, hidden-verifier failure triggers external continuation, affecting this project's continuation/completion comparison; separate official and no-feedback product tracks. Historical results predate verifier-isolation and binary-feedback changes and cannot be pooled with new runs; no complete public DSH reproduction was found. |

Suggested order: Terminal-Bench controls → a small DeepSWE engineering sample → consecutive SlopCodeBench tasks; expand to LongCLI and LHTB after protocol calibration. First run reference-solution, unmodified-artifact, and check-runner gates without model work; then freeze untuned tasks, four arms (Goal/Plan/log-only review/independent-check review), repetitions, and resources. Small samples diagnose integration and failures; replacement claims still follow the [claim threshold](#claim-threshold). Select tasks by fixed metadata rules rather than expected wins.

Retain strict success, partial requirement completion, regressions, false completion, legitimate waiting, internal faults, infrastructure failures, and all Session usage. Measure active duration, rounds, compaction, and progress trajectories too: a long timeout does not establish sustained long execution. Product review sees only public requirements, artifacts, and its own checks, never external hidden-grader feedback; correction and false-pause metrics remain missing without blinded labels.

## Initial comparison protocol

The first comparison uses native Goal, native Plan, and Task Supervisor. Match the main Agent's model route, reasoning settings, tool permissions, and context limits, recording the resolved model. Supervisor review defaults to the main model; count all reviewer and subagent resources. Start each arm in an independent environment from the same snapshot, randomize execution order, and repeat paired trials by task.

The product track gives each arm normal native interactions and predefined approval opportunities. Define Plan approval, execution start, idle, user-wait, and termination conditions before running; do not count legitimate waiting as immediate failure or improvise rescue prompts. Label evaluator-provided continuation experiments as the mechanism track and report them separately. Tasks without a frozen protocol remain development pilots.

Formal superiority claims still require the Lead–Worker Team control and the state-and-continuation-preserving ablation without semantic review defined below. Initial three-arm results support only comparisons of those workflows on selected tasks, not claims that review itself wins or that Supervisor beats Team.

External grading is independent of product review. Keep hidden tests, reference solutions, and scoring material inaccessible to the tested Agent; grade an independent copy and retain original artifacts. Do not feed hidden failures back until the Agent passes. Agents may use public task tests. Verify reference success and expected empty-patch failure first to prevent spurious grader success.

## Comparison and evidence rules

The Team arm uses a root Lead plus one Worker, with native planning and Goal continuation on the Lead and explicit responsibility for verification and correction. Validate the combined preset and real task-control authority; provide equivalent access to requirements, artifacts, and execution evidence. Match a stronger reviewer model in the Team arm or report a separate allocation experiment; do not attribute resource differences to supervision. See the [first prototype](prototype.md) for Team composition and product responsibilities.

The ablation without semantic review retains the same state, planning, continuation, and model configuration and uses the same external grader. Optionally compare stage-only review against stage review with fallback observation, reporting pauses and success together so excessive interruption cannot count as effective supervision.

Each arm plans independently; compare progress through shared external outcome milestones, not hidden reference plans or self-declared stage counts. Stages should identify artifacts, checks, and reopening conditions after requirement changes. A shared prescribed plan is a separate diagnostic. Freeze public tasks, constraints, allowed edits, acceptance rules, event scripts, and initial environments before running.

Protect external grading material; task-permitted project-test edits do not automatically fail. Capture tracked and untracked artifacts. Use predefined blinded review for requirements executable tests cannot cover, hiding arms when practical; report uncheckable requirements and evidence gaps rather than counting them as satisfied.

## Evaluation layers and development regressions

These are evidence categories, not execution order. Public benchmarks follow the [execution order](#execution-order); replay and lifecycle regressions preserve fixes and diagnose failures.

| Layer | What it establishes | Limit |
| --- | --- | --- |
| Historical trajectory replay | Review findings, evidence quality, and intervention choices. | Expose only evidence available at that point; include normal progress and reasonable retries so constant criticism cannot score well; it cannot establish improved outcomes. |
| Deterministic Host regressions | State transitions, cancellation, durable recovery, and stale-decision rejection. | Cover editing during review, clear with queued continuation, closing with pending timeouts, and manual recovery after restart; validate capacity and fork as those capabilities become available. |
| End-to-end comparison | Task outcomes from identical inputs to independent acceptance. | Use frozen tasks and specified controls; product review is under test and grading is external. |

Development cases cover short repairs, multi-stage features, requirement changes, ineffective retries, unsupported completion, and long stages without milestone reports. Short tasks reveal needless overhead and long stages reveal missed drift; these cases do not replace the public primary evaluation or an untuned holdout.

## Required metrics

Collect metrics during initial integration rather than choosing favorable numbers afterward. Store functional acceptance, constraint adherence, and completion declarations separately before aggregation.

| Metric | Definition and reporting rule |
| --- | --- |
| Independent acceptance rate | Externally accepted task runs / task runs with valid grading; also report scheduled runs, all attempts, and ungradable runs. |
| Constraint-respecting success rate (primary) | Runs passing external acceptance and all checkable explicit constraints / runs with valid grading; incomplete and execution-limit outcomes fail. |
| False completion rate | Runs declaring final completion but failing external acceptance or constraints / gradable runs declaring final completion; report raw counts too. |
| Stalls and termination reasons | Distinguish completion, legitimate waiting, no-progress stops, resource limits, model or tool errors, and infrastructure failure; record final state for every run. |
| Human intervention | Count scripted approvals separately from extra rescue; primary comparisons forbid improvised rescue, whose outcomes belong to diagnostics. |
| Review effectiveness | On independently labeled checkpoints, report true findings, false positives, misses, and unnecessary pauses; without labels, report only raw review and pause counts. |
| Progress and resources | Total, active, and waiting time; main Agent, reviewer, and other subagent rounds and tokens; tool and review calls; cost when available. |
| Drift and correction | With independent labels, record first observable drift, detection position, recovery rounds and duration, unsupported completion requests, and valid completions rejected; otherwise retain traces for analysis. |
| Repeat reliability | Per-task repeated outcomes and paired differences; estimate uncertainty by task rather than treating repeated runs as new tasks. |

Report zero denominators as not applicable and missing logs or usage as missing rather than zero. Keep ungradable infrastructure failures in the attempt manifest; predefine bounded retries, retain every failed attempt and retry, and report failure counts and coverage effects. Cost and speed are secondary; do not hide success or false completion rates inside a weighted score.

P3 additionally reports whole-Session success, success by task position, regressions of prior functionality, task-boundary errors, and recovery success. Use Sessions as the primary statistical unit then; dependent tasks in one chain are not independent samples.

## Automation and result artifacts

Drive tasks through native DSH interfaces or a headless profile; evaluate browser UI separately. Reuse public benchmark environments and grading rather than rebuilding the scoring system first. Manage isolation through the existing skill and registry; each formal task starts from a fixed snapshot without leftover manual-test files.

Save at least the following per run; finalize file formats during runner integration:

- Run manifest: dataset version, task ID, arm, repetition ID, DSH and plugin versions, model settings, tools and context configuration, approval policy, and execution limits.
- Raw evidence: main Session, review, and subagent logs; state events; start and end times; patches and required untracked artifacts.
- External grading: grader version, check results, constraint checks, completion declaration, termination reason, errors, and retry associations.
- Metric details: individual runs, per-task summaries, paired arm comparisons, task-family outcomes, and failure examples.

Split development and holdout sets by repository or task family before tuning review policy. Predefine violations, true interventions, stalls, and final completion; record model seeds when supported, otherwise traceable repetition IDs.

Reports show original acceptance results alongside compliance and completion-judgment measures for each dataset. Report datasets separately; freeze weights and aggregation rules before any pooled summary. Separate development samples from a frozen holdout and do not infer generalization from repeatedly tuned cases.

## Later multi-task Sessions

Once public baselines are stable, add fixed scripts that create Task 1…N, Goal 1…N, or Plan 1…N in one Session, with matching user tasks at each position; each arm retains its own history and actual artifacts. Add fresh-Session-per-task controls to distinguish task difficulty from accumulated context.

Cover independent task switching, ongoing project evolution, requirement edits, and compaction, pause, or restart recovery. Separate Session-wide constraints from task-local constraints; never silently replace prior artifacts with reference results. Label dependent-chain diagnostics using canonical prerequisite snapshots separately. Start with executable cases such as an evolving billing tool, then expand to real projects.

Deliver the next task at predefined termination or limit conditions, not after hidden grading passes. Trigger mid-task changes at commonly observable events and record delivery and application positions; do not use Supervisor stage review and native first-file-write as different triggers. The [χ-Bench-Marathon same-Session protocol](https://arxiv.org/html/2605.16679v1) is a reference, not a transfer of its business domain or scores to DSH.

## Existing evidence and next actions

The [short-task pilot](../eval/pilot-v1/results-20260926.zh.md), [ordering-constraint regression](../eval/reliability-v1/results-20260927.zh.md), and [requirement-revision development pilot](../eval/long-horizon-dev-v1/results-20260927.zh.md) preserve fixes and diagnose failures; they are not public long-horizon benchmark results. Revision delivery timing differs between arms in the development pilot, preventing a direct win-rate comparison.

Current execution follows the [long-horizon batch](../eval/sandbox-run/long-horizon-20261009/README.md):

- [x] Pin four DeepSWE holdout tasks and pass Linux execution, empty/reference-patch grading, and independent-check admission for each.
- [x] Freeze interactions, termination conditions, execution limits, retries, execution order, and metrics for all three arms.
- [x] Integrate the DSH runner and produce real records with native terminal state, external grading, approval receipts, and usage.
- [ ] Seal all 24 positions, retaining infrastructure anomalies, reasons for unexecuted positions, and the full denominator.
- [ ] Complete paired per-task analysis, cost and trajectory reporting, and small-sample uncertainty.
- [ ] Develop and run the multi-task Session protocol after the baseline is stable.

## Claim threshold

Three-arm pilots report observations on selected tasks only. A formal replacement claim requires frozen datasets, protocols, and acceptance rules plus native Goal, Plan, Supervisor, and Team comparisons; attributing gains to review also requires ablation evidence. Report uncertainty, task families, and failure cases, and predefine acceptable false interventions and user interruptions. If Team matches outcomes with simpler configuration, narrow the claim or reuse its mechanism.

## Reuse sources

The local [forever-subagents evaluation design](../../../forever-subagents/docs/eval-design.md) supplies fixture, task, write-scope, checks, transcript, and run-result concepts. The [DSH harness design](../../../forever-fish/docs/harness-eval-design.md) supplies retrospective analysis, mechanism checks, and end-to-end comparison as separate layers. The [WorkDAG design](../../../forever-fish/docs/workdag-eval-design.md) supplies evidence-integrity checks and controlled recovery failures. These are source proposals, not proof that their proposed runners or datasets already work. The existing [trajectory analyzer](../../../forever-fish/eval/analyze_dsh.py) is candidate code; validate its parser against the pinned DSH event format before reuse.

Reuse task inputs, write scope, acceptance, transcript, and result concepts with versioned constraints, scripted events, and external scoring; report resources separately. DAG measures cover real dependencies, stage progress, recovery, and correct stopping rather than treating concurrency as success. Revalidate old Jev lessons on structured review, termination, and recursion prevention; exclude the old website demo from the primary evaluation. Trace export is optional; local artifacts must suffice for reproduction without a dashboard.

Benchmark counts, model scores, SDK commands, and infrastructure estimates in source proposals are not current facts; verify primary sources and actual environments during integration.

## Dev Note

This document is the evaluation entry point. Each batch's frozen protocol defines its tasks, environment, model, authorization, and official-grading adaptation; observed runs belong in its result records. Historical batches retain their original definitions, and later runner repairs preserve separate versions and protocol deviations.

## OpenSandbox long-horizon batch

The [paired protocol](../eval/sandbox-run/protocol.md) pins four tasks, three conditions, and two repeats. Development revision and fault-recovery cases, four-task admission, actual model routing, clean installation, and positive/negative grading controls passed; see the [development validation](../eval/sandbox-run/validation-20261009.md).

Formal execution has started. Sealed counts, per-condition progress, runner repairs, and environment handoff are maintained in the [batch record](../eval/sandbox-run/long-horizon-20261009/README.md). [Result snapshots](../eval/sandbox-run/long-horizon-20261009/reports/) retain all 24 positions. Started positions reconnect to their original Session, artifacts, and deadline; only Agent-committed patches are graded. Infrastructure anomalies have null reward, and official full reward is reported separately from strict controller success. The complete paired report follows sealing of every position.
