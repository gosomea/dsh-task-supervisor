# Native review process and recovery

## Reviews in the primary conversation

Each durable review job creates one node where it intervenes, showing the Supervisor identity, review kind, node title and attempt. Planning, plan, progress, node and final reviews do not depend on the completed primary Turn tail.

Expanding a review retains its own Session and uses native Chat for streaming replies, tool groups, errors, timing and history. It adds no composer and leaves primary Agent responses intact. Returned reasoning follows native presentation settings.

Active processes expand by default and collapse when settled. Historical Sessions are retained only while expanded. Queued jobs wait for the review Session to exist; reading history never launches a model. Refresh reconstructs the same job and retries do not create a second card.

## Implementation and verification

Step one connects the native conversation node. Step two distinguishes queuing, response generation, evidence reads, checks and decision application, showing the current tool, last record age and deadline. Failed tools are not successful reads. Outstanding parallel calls remain visible until settled.

Actual Turn events determine whether the primary Turn ended. During review, the DAG dock no longer presents a prior node verdict as current activity. Sidebar links locate the same review job in the primary transcript. The legacy JSON endpoint remains compatible but is not the primary viewer.

## Controller recovery and evidence inheritance

Formal submissions and manual retries persist first and return promptly. Public lifecycle interfaces run review after the primary Turn or command settles. Internal timeouts and recognizable connection faults, request timeouts, rate limits and temporary service errors retry once by default. Authentication, configuration and unknown faults do not loop automatically. Each attempt starts after the old reviewer fully stops, retaining the Session, model, requirements version, node attempt, evidence cutoff and artifact snapshot. Protocol supplements have a separate counter and do not extend the current deadline.

Version 7 review records preserve the original permit, recovery policy, consumed retries and fault history. Valid execution approval and versions permit automatic continuation; user pauses, disabling, Host restarts, needs-user and old records without permits remain manual. `resumeAfterReviewRecovery: false` retains the result for manual continuation. Recovery does not grant approval; the first plan still follows the original approval policy.

Recovery rebuilds read eligibility from paired successful native reviewer tool results. Actual event seqs, file hashes, read ranges and truncation markers remain authoritative. An index only locates evidence; failed calls and model claims cannot establish citation eligibility. Independent mode retains the check plan, snapshot and phase boundary. Unreliably recoverable old reads require rereading. Artifact changes reject old verdicts. Pauses, disabling and unload interrupt recovery waits; cleanup waits for work to stop and clears timers.

## Configuration

| Setting | Default | Range and meaning |
| --- | --- | --- |
| reviewFaultRetryAttempts | 1 | 0–3 automatic fault retries per job |
| reviewFaultRetryDelayMs | 3000 | 0–60000 ms before retry |
| resumeAfterReviewRecovery | true | Reuse only the original valid execution permit |

Planning and progress review frequencies remain unchanged. No browser executor, PTC timeout or native sandbox changes are introduced. Kernel acceptance passed 403 tests with 13 skipped; strict Host/Client types passed. Real-model, browser and public-package installation acceptance still precede release; types or packing do not substitute for these outcomes.

[中文](review-experience.zh.md)
