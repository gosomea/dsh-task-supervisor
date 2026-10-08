# Review progress and plan handoff

The primary conversation now uses the native reviewer Session directly; the sidebar locates the same record instead of using JSON polling as its main viewer. See [native review process and recovery](review-experience.md) for current activity, recovery and boundaries. Earlier-version evidence is retained below.

2026-10-07: This change explains ownership after the main Agent's turn ends and prevents an unnecessary progress review immediately after a formal checkpoint. The [validation record](review-progress-checks.json) separates kernel, real-model and browser evidence.

## Observed failure

Daily Session `session-403cc21d-d6d0-4f82-a0df-bf2c72b41226` had submitted a six-node plan. The main turn settled normally while the controller ran plan review. Native “completed” described that turn, not the whole Task. The UI read unapproved `task.stages`, showing zero nodes and “preparing plan” without the proposal or review activity.

The first verdict requested revision. The controller retained the pre-review observation time and sequence, counting formal-review time toward main-Agent observation. It immediately started a planning-progress review and delayed delivery of revision findings. The revised plan subsequently passed; task state had not been lost.

## Changes

- Reset the main Agent's observation window after a formal verdict applies. Idle observation cannot review turns preceding that boundary again. New planning activity remains subject to the existing progress policy.
- Preview the current proposal DAG in both surfaces, explicitly unapproved or awaiting revision. Reject mismatched versions. Previewing never updates the accepted plan or grants execution authority.
- Distinguish plan, planning-progress, node and completion review. Show measured elapsed time, successful evidence reads, tool failures, last-event age and job deadline, plus the next handoff: revision, approval or implementation.
- Derive activity from actual reviewer Session events without a completion percentage. Read counts do not prove requirement coverage or independent artifact checks. Log review no longer displays a misleading zero independent checks.
- Open retained review records read-only and refresh every two seconds while active. Unmount releases timers and requests. Reads never dispatch models, recover jobs or approve tasks.

Main-Agent answers retain native rendering. DSH's main loop, sandbox, default PTC budget, approval policy and progress frequency are unchanged.

## Validation and deployment

Six related kernel files passed 213 checks; one existing Docker-config-dependent check was skipped. Removing the observation repair makes its regression fail. A controlled native Agent review verifies activity counts, proposal preview, version isolation and no dispatch on read. Three focused regressions passed again after bounded fixture cleanup. Strict Host/Client typechecks, build and eleven-entry package checks passed.

Registered environment `supervisor-standard-install-20261004` uses unmodified official npm DSH 0.2.0-rc.2. Real CodeBuddy `deepseek-v4.1-flash` PTC Session `session-94dc6b3e-8b68-422a-bde5-b38f7d99b69f` reviewed a read-only two-number plan in about 62 seconds, passed and waited for approval. One decision call was rejected and succeeded after additional evidence reads. No approval or implementation occurred and input stayed unchanged. This case verifies handoff and manual approval, not final acceptance or independent-runner quality.

Daily port 3080 was updated through native plugin installation when every Session was idle. Package `c47e14989636` preserved 535 Sessions, other plugins and configuration. Browser inspection confirmed the six-node DAG and approval wait in both surfaces. The user then approved and implementation began; the running instance was not restarted for further checks. An intermediate live-review browser view was not separately captured; native Host regression and typechecking cover its fields and polling logic.

Read-only history after Host restart does not automatically load an execution Agent. A cold Session can display its plan; “批准” or the applicable `/task resume` in the main conversation restores control. GET remains read-only. The existing ten-minute log-review deadline is unchanged: the model can still wait without new events, or an internal fault can pause review.

[简体中文](review-progress.zh.md)
