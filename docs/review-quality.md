# Generic independent review enhancement

## Summary

Review follows original requirements, actual evidence and suitable methods. Steps 0–3 are implemented and separately committed, with source gates and cross-artifact real-model fixtures validated. A complete static task finishes through the controller; the official Kea regression is sealed with reward 0 after formal-plan review timeout in the frozen version, with subsequent protocol repairs validated separately. The [validation record](../eval/independent-verification/generic-quality-20260930/README.md) retains successes, an internal timeout and an adapter failure.

## Completion criteria

Main Agent claims, main Session execution records and reviewer-acquired evidence remain distinct. An independent Session is not independent verification; log review only claims inspection of cited logs.

Original user requirements govern acceptance; plan criteria organize work. The reviewer plans checks, acquires independent evidence, then compares reports; hypotheses remain distinct from explicit requirements.

## Implementation sequence

0. Align review policy, implementation status and bilingual documentation. This page does not claim unimplemented capabilities.

1. Add `reviewVerification: log | independent`, effective mode and capability scope. Preserve legacy behavior; reads do not require a command runner, and missing necessary capabilities are explicit. Plan review uses normalized dependencies.

2. Add durable `task_review_check_plan`: record requirement sources, methods, expectations and coverage before reading deliverables. Append checks with revisions; decisions cite evidence acquired by this job. Version review records while preserving legacy jobs.

3. Add cutoff-bound, filtered and paginated `read_task_evidence_index`. Index entries do not replace original evidence reads. Show planning, independent inspection, comparison and decision phases; measure cost without changing review frequency.

Validate each step, commit and push it separately, then verify the remote ref. Changes stay in the plugin and existing evaluation adapter; no main-loop or native-sandbox changes.

## Capability boundaries

Reuse artifact snapshot reads and isolated command execution. Behavioral requirements need execution or reproduction; static requirements can use reads. Independent browser observation is unavailable and cannot be silently downgraded or fabricated.

Preflight known capability requirements; broad objectives may first discuss and plan, then preflight before implementation approval. Final acceptance uses a current snapshot; earlier node passes do not imply overall acceptance.

## Validation and evaluation

Fixtures cover static documents, structured artifacts, calculations, missed behavior despite green tests, correct products, misleading reports, missing capabilities, repair/restart and changed artifacts. Wrong products cannot complete; unsupported preferences cannot block correct ones.

Run kernel tests, both typechecks, build and package inspection, then real-model positive and negative cases in registered isolation. Freeze the version and run one clean enhanced-Supervisor Kea case with one authorization, a fixed deadline, no rescue and official independent grading.

Report reward, F2P/P2P, independent coverage, false acceptance, internal faults, time and all tokens. Unannotated blind-review metrics stay null. Kea is an exposed development regression, not unseen evidence or a superiority claim over Goal or Plan.

## Dev Note

The two Kea failures remain [public grading cases](../eval/deepswe/supervisor-single-20260929/README.zh.md), not generic prompts or controller rules. The validation record above retains implementation and official grading evidence, including successes and failures.

The subsequent [overall review proposal](proposals/review-optimization.md) addresses task attribution, evidence correction, requirement findings and long-horizon validation. Its first display step is implemented; the remaining scope and release are pending. This page retains the existing independent verification boundaries.
