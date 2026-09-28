---
description: "DeepSWE integration sample, Terminal-Bench control calibration and model-delivery gates."
kind: "scratch"
---

# DeepSWE independent-review integration pilot

## Summary

This directory fixes an engineering pilot for enhanced independent review: two public tasks, four conditions and two paired repeats, for 16 planned positions. It checks whether DSH control, artifact submission, independent checks and external grading work together. The [evaluation owner](../../docs/evaluation.md) maintains the research question and later continuous-task route. This sample cannot establish superiority over Goal, Plan or Team.

## Fixed tasks and order

The [sample](sample-20260928.json) fixes the dataset commit, metadata and instruction SHA-256, base commits, resources, deadlines and delivery order. `select_sample.py` reads metadata only and selects one Go and one TypeScript task by seeded SHA-256, excluding nine published FrontierHarness examples. Sample selection sent no model requests.

| Task | Language | Official main resources | Official Agent / verifier deadlines |
| --- | --- | --- | --- |
| `helm-array-merge-strategies` | Go | 2 CPUs, 8192 MiB RAM, 20480 MiB disk | 10800 / 1800 seconds |
| `kea-atomic-signal-selectors` | TypeScript | 2 CPUs, 8192 MiB RAM, 20480 MiB disk | 10800 / 1800 seconds |

The dataset is [DeepSWE v1.1](https://github.com/datacurve-ai/deep-swe), fixed at commit `0b9fabbb63b9104d678fe965e1632f2dd9eaa2ea`. Official grading runs separately and extracts a committed patch from the base commit to `HEAD`. The evaluator does not commit Agent changes automatically; uncommitted artifacts at the deadline remain separate diagnostics. Candidate image tags must be pinned to actual digests before admission.

## Four conditions and metrics

Each task and repeat pairs native Goal, native Plan, Supervisor reading logs only, and Supervisor with independent artifact checks. Both Supervisor arms use the same progress-review frequency. The independent arm reads artifacts, executes necessary checks and records observations before reading the main report during node and final reviews. Plan and progress reviews retain lightweight log checks.

Main and reviewer requests use the daily verified first `deepseek-codebuddy` model, `deepseek-v4.1-flash`. Each arm receives one initial approval and no rescue; the task deadline includes approvals, review waits and continuation. Each attempt uses its own Session and official task environment. Extra check-container resources and CPU time are reported separately; main-session tokens do not represent total cost.

Primary success requires the native controller to finish before the deadline, official independent reward 1, and no grading infrastructure fault. Report all 16 positions, paired task outcomes, rewards, false completion, deadlines, internal review faults, infrastructure faults, all-session tokens, review/command waits, protocol repairs, human interventions and independent evidence coverage. Correction benefit and false-pause rate remain `null` without blinded labels.

## Control calibration

First calibrate `kv-store-grpc` and `db-wal-recovery` from [Terminal-Bench 2.1](https://github.com/harbor-framework/terminal-bench-2-1), commit `d49e28f1e4ddd13d289e85a5f312a66750951932`, covering background services and file artifacts. Existing Harbor 0.23.0 runs official oracle/nop without model calls. See the [machine evidence](controls-20260928.json).

`read_control.py` checks complete CTRF reports for these two controls. Missing reports, unrun tests or reward/summary disagreement produce reward `null`; the script-written raw reward remains diagnostic. Ordinary failed tests are not all infrastructure faults: missing task-required files, dependencies or services under nop remain valid failed controls. The separate DeepSWE verifier contract needs its own validation; it must not assume the same report file.

Both tasks produced oracle 1 and nop 0, each with seven fully executed tests. Six calibration attempts contain four valid scores and two infrastructure faults; DSH-native control admission remains pending.

Calibration uses `colima-dsh-eval-rosetta` with official per-task 1 CPU, 2048 MiB and 900-second settings. The initial image-download error in another context and the database oracle's grading-dependency download failure remain in the denominator. Another keyless infrastructure calibration receives a new job name and never overwrites old results. Formal model attempts are not automatically rerun or replaced.

## Admission and reproduction

The current sample has `modelAdmitted=false`, `release=null` and model attempts 0/16. Candidate-specific empty/reference grading, complete artifact capture, actual native checks, background/cancellation cleanup, primary-tool parity and main/reviewer model parity must pass before delivery. Then freeze runner, runtime, plugin, profile, image digests, resources and order, with evidence for every gate.

`require_admission` validates release structure, the paired matrix and binding to the original sample SHA-256 only. It does not execute real gates, and successful test fixtures cannot replace calibration. The formal runner and evidence admission remain pending. Selection creates output exclusively. A started attempt without a result requires reconciliation of its original Session, process and deadline, never another Agent delivery.

```sh
python3 -m unittest discover -s eval/deepswe -v
```

This command checks reproducible selection, wrong revisions/dirty trees, pairing, admission refusal, grading reports and exception redaction. Real artifact and process regressions are in the [independent-check integration record](../independent-verification/README.md).

## Dev Note

This batch stays separate from the frozen P2 batch. Scheduled follow-ups remain disabled; user Web deployments and the old controller retain their own configuration. SlopCodeBench remains a later continuous-requirement candidate, with its official fresh Sessions reported separately from our same-Session extension.
