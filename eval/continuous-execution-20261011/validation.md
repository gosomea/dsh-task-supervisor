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
