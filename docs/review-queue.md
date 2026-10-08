# Controller-owned review jobs

See [native review process and recovery](review-experience.md) for 0.1.3 controller recovery and the native primary-conversation process. Formal submissions and manual retries return promptly. The evidence below describes 0.1.2 history; the former always-manual continuation after recovery has changed.

This reference covers plan, node and whole-task submission, cancellation and recovery. See [validation evidence](review-queue-checks.json).

## Submission and execution

Before returning, `task_submit_plan`, `task_report_stage` and `task_request_completion` persist the job and task state: task/plan versions, node attempt, evidence cutoff, reviewer Session ID, model route and review deadline. The task enters reviewing; the tool returns `queued: true` and the job ID and concludes this turn. Success acknowledges submission only. Acceptance requires a valid applied decision. Legacy configuration explicitly disabling plan coverage review retains its no-review path.

Supervisor waits for the main Agent activity to settle, then runs the saved job through public `withoutInitiator` and `runMaintenance` APIs without retaining the retired tool signal. Dependent nodes cannot advance during review. After persisting the decision, the controller checks task identity and artifact freshness before changing the DAG and delivering continuation or a native text summary. A plan revision can continue planning; initial execution still requires existing approval or explicit preauthorization.

Native and PTC tools share this mechanism. The PTC default remains 120 seconds; the program's normal `run_code settled` signal no longer cancels handed-off review.

## Cancellation and manual recovery

| Source | Result |
| --- | --- |
| Review deadline | Persist a retryable `timeout`, pause and recover the same job through `/task retry-review`. |
| User pause or Supervisor off | Cancel review, disarm continuation and wait for manual recovery. Re-enable first after off; do not retry automatically. |
| Main Agent stopped after submission | Retain an unstarted queued job; wait for `/task resume` without dispatching a reviewer. |
| Task or relevant artifact changes | Reject stale decisions; the new requirements or artifact need valid review. |
| Plugin unload, Host exit or restart | Quiesce owned work and retain jobs/evidence. A new Host waits for `/task resume` without automatic dispatch. |
| Normal outer PTC settlement | Continue the handed-off job. |

Manual recovery retains the original job, reviewer Session, requirements, plan, node attempt and cutoff while starting a new review attempt with a fresh deadline. Recovery is review permission, not implementation permission; approve the plan or explicitly resume execution afterward. Existing independent snapshots must still pass freshness checks. Existing protocol repair and independent inspection rules remain in force. When a valid decision is durable but not yet applied, manual recovery checks artifact freshness and adopts it without another model request.

Ordinary cancellation is not automatically retryable. Historical `run_code settled` failures receive an appended retryable timeout only when original logs correlate that nested submission with the matching root call's actual timeout result. Original events remain intact; no automatic recovery occurs and user cancellation is not promoted to timeout.

## Persistence and scope

Task record 15, review record 6 and projection cache 19 add controller ownership, queued state and bound job identity, while retaining legacy readability without invented artifact evidence. The queue Map manages current-process admission, not authoritative storage. Lifecycle cleanup waits for owned work to settle.

This implementation stays within the plugin, using public Agent, Inbox and Session APIs and the existing reviewer. It does not change the DSH main loop, native sandbox or PTC budget. Progress observation retains its existing policy; this lifetime fix adds no artifact-read, execution or browser capabilities.
