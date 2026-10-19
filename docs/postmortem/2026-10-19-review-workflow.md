# Review workflow implementation and validation (2026-10-19)

## Problem and causes

Recent 0.1.8 Session evidence shows a node review with seven applicable criteria repeatedly including final-only c-final-scope: 19 decision calls produced 15 generic coverage errors. Another earlier job ended during its model request; the latest pause includes a valid needs-user decision. These require separate attribution, not a blanket infrastructure diagnosis; lack of acceptance is not a product score of zero.

A further regression reproduced release acquiring the execution lock too early while a reviewer was still active. Release now waits for cancellation and cleanup, rechecks the task version, then continues.

The old flow put investigation, checks and decision submission inside one deadline; long checks consumed the decision window and findings were saved only on complete submission. Users could retry but lacked explicit human release, repeatedly encountering the execution gate.

## Implementation

- A: exact applicable scope and missing/extra/duplicate details; bounded identical errors without progress and a decision reserve.
- B: incremental findings, explicit unverified coverage, same-identity recovery, evidence references and whole-task acceptance; no automatic cross-job acceptance reuse.
- C: separate model/check accounting, durable check admission before execution, and gateway v2 receipt collection without repeating execution.
- User controls: skip one review, skip and approve a plan once, and human final closure; preserve outcomes and provenance without recording pass.
- D: the project architecture specifies a specialist interface; no executor or review team is enabled.

## Validation evidence

| Layer | Result |
| --- | --- |
| Native kernel and isolated Docker | 34 files, 503 tests passed, zero skipped; includes gateway v2 restart and the receipt-write window, with exactly one command execution. |
| Additional deterministic boundaries | User actions, repeated invalid decisions, release during an active review, stale callbacks and three-hour compatibility are included above. |
| Types and package | Host/Client strict typechecks passed; build and npm pack completed and supported installation into an isolated profile succeeded. |
| Real model | Both main and reviewer used deepseek-codebuddy / deepseek-v4.1-flash; plan review passed on its first attempt, retaining awaiting-approval without automatic approval. |
| Browser | Final installed package renders the plan pass card, approval boundary and controls. Faulted live-model bypass was covered by native command and presentation tests, not a browser click. |

See [review-workflow-evidence.json](review-workflow-evidence.json). The package uses the 0.1.8 manifest in an isolated home as an unreleased source build; it is not the published 0.1.8 artifact. No npm publication, GitHub Release or daily 3080 deployment occurred. The earlier development regression remains paused and its evidence is unchanged.

## Limits and follow-up

These checks validate mechanisms, not model-quality, performance or benchmark gains. Cross-job content caching, specialized browser checks and D specialist executors remain future capabilities; missing evidence stays unverified. Deterministic budget tests cover long-task limits; no two-hour real model request was run for this test.
