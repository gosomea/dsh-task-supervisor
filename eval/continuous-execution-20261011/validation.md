# Continuous execution validation

English | [简体中文](validation.zh.md)

Step 0 passed: the complete worktree starts at `2edbbc3`; `src` and kernel tests match `44b2a42`. The approved Note and retained planning Note pass the DSH Markdown structure parser, pair hashes, local links and lifecycle format checks. This is a scoped plugin check, not the full DSH doc-sync gate. No behavior or model run has been validated yet. Steps 1–6 remain pending.

Machine evidence: [step-0.json](step-0.json).

## Step 1: durable handoff

Validated the decision receipt before acknowledgement, cancellation after the receipt, recovery without another model request, revised-plan continuation without approval, and exact dispatch reconciliation. Fifteen focused Host cases passed; the adjacent source run passed 219 cases with one platform skip and exposed three old version-only expectations. The updated planning-review suite then passed all 53 cases. Host/Client strict checks and build passed. Restoring the old unconditional plan version increment makes the revised-plan recovery regression fail. The receipt uses record 9; later fields remain pending. Evidence: [step-1.json](step-1.json).
