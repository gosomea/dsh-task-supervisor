# Continuous execution validation

English | [简体中文](validation.zh.md)

Step 0 passed: the complete worktree starts at `2edbbc3`; `src` and kernel tests match `44b2a42`. The approved Note and retained planning Note pass the DSH Markdown structure parser, pair hashes, local links and lifecycle format checks. This is a scoped plugin check, not the full DSH doc-sync gate. No behavior or model run has been validated yet. Steps 1–6 remain pending.

Machine evidence: [step-0.json](step-0.json).

## Step 1: durable handoff

Validated the decision receipt before acknowledgement, cancellation after the receipt, recovery without another model request, revised-plan continuation without approval, and exact dispatch reconciliation. Fifteen focused Host cases passed; the adjacent source run passed 219 cases with one platform skip and exposed three old version-only expectations. The updated planning-review suite then passed all 53 cases. Host/Client strict checks and build passed. Restoring the old unconditional plan version increment makes the revised-plan recovery regression fail. The receipt uses record 9; later fields remain pending. Evidence: [step-1.json](step-1.json).

## Step 2: fixed budget and convergence

The adjacent source selection passed 221 cases with one platform skip. Two additional Host cases reject a saved decision after expiry without another request and stop recovery after injected disposal uncertainty. A 600-second controlled-clock review converges at 420 seconds, requests a decision at 480 seconds and submits in the same job. A shorter Task deadline stops all phases and confirms cleanup. Same-job request retries retain one deadline; native tool cancellation waits for command settlement. Unknown costs stay complex; estimates narrow once and cannot extend the admission cap. Restoring per-retry deadline renewal makes the recovery regression fail as intended. Host/Client strict checks, build and scoped bilingual structure checks pass. Machine evidence: [step-2.json](step-2.json). Steps 3–6 remain pending; no new model, browser or public-question run yet.


## Step 3: incremental findings and evidence reuse

The adjacent selection passed 243 cases with one platform skip. Eight focused native Host cases cover correct and wrong content, mandatory gaps, unread references, transient recovery, missing-Session replacement, controller sealing at 480 seconds, and unchanged raw command reuse during completion. Four pure cases check immutable revisions, optional preferences, identity mismatches and scope preservation. Removing incremental history lookup makes the correct-product regression fail as intended. Host/Client strict checks, build and scoped bilingual structure checks pass. The command-cache fixture mocks the native runner result; it verifies receipts and applicability, not new Docker confinement. Machine evidence: [step-3.json](step-3.json). Steps 4–6 remain pending; this step claims no real-provider or public-question score.

## Step 4: repair boundaries, delivery and real presentation

This gate passed. Cumulative repair accounting and original-requirement permits use Task 17 / projection 26; review records remain version 9. Execution is serial by default. Progress review now follows actual anomalies (3 consecutive tool errors or 2 durable no-progress observations); explicit legacy settings remain compatible. Limits are 3 replans per Task, 3 reworks per node and a stop after two repair rounds without new related artifacts or verification. Pause, changed requirements and completed-task reopening grant no new automatic rights. Completion checks nodes, the current whole snapshot and requested delivery, without universally requiring Git.

Machine evidence: [step-4.json](step-4.json). Adjacent regressions passed 288 with one platform skip; the final presentation correction passed 18 tests. Eight focused native incremental cases include rejecting a sealed failure relabeled as satisfied using the same failed evidence; amendment requires new executed evidence. Host/Client strict checks, build, pack and official DSH 0.2.0-rc.2 installation passed. Fixture driver: [host_acceptance.py](host_acceptance.py).

| Real-provider fixture | Original position outcome | External development oracle |
| --- | --- | --- |
| Two-node document and calculation delivery | complete; 753.279s; one initial approval, no additional permit | summary.md preserves date, participants and decision; result.json sums to 22; inputs unchanged |
| Behavior omission and misleading report in the same Session | paused / needs-user; 309.403s; one initial approval | Independent execution finds n>10 returns 9; completing inspection cannot imply a correct product; all seven existing files unchanged |
| Missing required independent browser capability | Plan coverage passed; approval rejected CAPABILITY_UNAVAILABLE; no implementation or completion | Explicit preparation failure without fallback; original driver incorrectly asserted approval success, so its refusal receipt was retained and the same Session was sealed by a read-only collector without redelivery |

These are custom development oracles, not public benchmark rewards. All seven review jobs have submission receipts, effective applications and confirmed cleanup; none exceeded 600s or its configured limit. Deduplicated acquired Session projections total 653,433 uncached input, 227,159 output, 8,115,328 cache-read and zero cache-write tokens. The shared root uses only its latest cumulative projection. Native execution turns are not model requests; actual-wire route evidence remains a next-step admission gate.

Browser checks covered two Tasks and six correctly attributed nodes in one Session, full Markdown reports, independently folded native process, reload without duplication, historical expansion without a new execution turn, and no horizontal overflow at 430px. One historical-reading measurement retained scrollTop 5387; near-bottom automatic process collapse can still shorten the scroll range, so invariant scrolling is not claimed. Historical null-model compatibility and subscription cleanup have separate kernel evidence, not browser memory instrumentation. The obsolete planning hint next to an ended decision was removed. Candidate 7 changes only the client; its Host artifact exactly matches real-provider Candidate 6. Saved records were replayed without redelivering models.

Screenshots: [activity and narrow screen](narrow-live.jpg), [native historical tools](history-tools.jpg), [full report](full-report.jpg), [final state](state-and-result.jpg). The first new SSR test encountered two React copies; a pure presentation regression and real browser check replaced it.

Candidate 1–5 failures and fixes remain in [development diagnostics](development-diagnostics.json), with original positions preserved. The correct fixture still cost 12m33s and had parameter errors and repeated reads; efficiency improvement is unproven. Progress fingerprints inspect acquired output bytes, without semantic normalization. Daily 3080 was not restarted. Steps 5–6 remain: actual request route, official environment admission, frozen package and eight exposed-task development regressions have not started.
