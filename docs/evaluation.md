# Evaluation design and execution roadmap

**Updated: 2026-09-27. Status: study design and development pilots; public benchmark integration is pending.** This document owns evaluation questions, execution order, datasets, comparison arms, metrics, and result deliverables. There is no frozen long-horizon holdout or superiority claim; [architecture](architecture.md) owns product design and [implementation status](implementation.md) records working capabilities.

See [step F](10-plans/conversation-and-review-recovery/evidence/f.md) for the new development regression and audit, and the [frozen frequency protocol](../eval/review-recovery/frequency-p2-protocol.md) for follow-up conditions. Original frozen outcomes remain unchanged; the 60 follow-up attempts have not run.

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
| First | [SWE-bench Pro V2](https://github.com/scaleapi/SWE-bench_Pro-os/blob/main/v2/README.md) | Real repository tasks with official Harbor task directories, graders, reference solutions, containers, and independent patch regrading. Adapt DSH before expanding. |
| Second | [SWE-EVO](https://github.com/SWE-EVO/SWE-EVO) | Add project evolution across files and features; independently validate environment and grading stability. |
| Supplement | [Terminal-Bench](https://www.tbench.ai/news) | Add complex terminal work; pin a release, with Challenges as a candidate for longer single tasks. |

These are researched candidates, not completed integrations in this project. Pin dataset commits or versions, sample IDs, image digests, grader versions, and initial repository commits; inspect licenses and environment requirements before running. SWE-bench Pro V2 documents linux/amd64 images, requiring a verified Linux execution environment. Do not pool versions or describe altered tasks, interactions, network rules, or time limits as official scores.

Public coding datasets generally organize individual tasks. One task may contain many model interactions and continuations, which does not establish support for consecutive user tasks in one Session. Define that separately in P3; do not force tasks with incompatible repositories or base commits into one workspace.

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

- [ ] Pin the first public dataset and 6–12 integration tasks; validate Linux execution and external grading.
- [ ] Freeze interactions, termination conditions, execution limits, retries, and metric definitions for all three arms.
- [ ] Integrate the DSH runner and produce one real run record containing every required field.
- [ ] Run the three-arm public pilot and report per-task results and failure classes.
- [ ] Freeze a holdout, expand runs, and add controls required for the formal comparison.
- [ ] Develop and run the multi-task Session protocol after the baseline is stable.

## Claim threshold

Three-arm pilots report observations on selected tasks only. A formal replacement claim requires frozen datasets, protocols, and acceptance rules plus native Goal, Plan, Supervisor, and Team comparisons; attributing gains to review also requires ablation evidence. Report uncertainty, task families, and failure cases, and predefine acceptable false interventions and user interruptions. If Team matches outcomes with simpler configuration, narrow the claim or reuse its mechanism.

## Reuse sources

The local [forever-subagents evaluation design](../../../forever-subagents/docs/eval-design.md) supplies fixture, task, write-scope, checks, transcript, and run-result concepts. The [DSH harness design](../../../forever-fish/docs/harness-eval-design.md) supplies retrospective analysis, mechanism checks, and end-to-end comparison as separate layers. The [WorkDAG design](../../../forever-fish/docs/workdag-eval-design.md) supplies evidence-integrity checks and controlled recovery failures. These are source proposals, not proof that their proposed runners or datasets already work. The existing [trajectory analyzer](../../../forever-fish/eval/analyze_dsh.py) is candidate code; validate its parser against the pinned DSH event format before reuse.

Reuse task inputs, write scope, acceptance, transcript, and result concepts with versioned constraints, scripted events, and external scoring; report resources separately. DAG measures cover real dependencies, stage progress, recovery, and correct stopping rather than treating concurrency as success. Revalidate old Jev lessons on structured review, termination, and recursion prevention; exclude the old website demo from the primary evaluation. Trace export is optional; local artifacts must suffice for reproduction without a dashboard.

Benchmark counts, model scores, SDK commands, and infrastructure estimates in source proposals are not current facts; verify primary sources and actual environments during integration.

## Dev Note

This document records the unified evaluation protocol and pending work, not run results. Finalize task IDs, formal sample size, execution environment, exact model versions, and official-protocol adaptation during integration; record observed runs in their evaluation result documents.
