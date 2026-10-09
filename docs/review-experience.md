# Native review process and recovery

## Reviews in the primary conversation

Each durable review job creates one node where it intervenes, showing the Supervisor identity, review kind, node title and attempt. Planning, plan, progress, node and final reviews do not depend on the completed primary Turn tail.

Expanding a review retains its own Session and uses native Chat for streaming replies, tool groups, errors, timing and history. It adds no composer and leaves primary Agent responses intact. Returned reasoning follows native presentation settings.

The plugin owns a public shell-slot entry and portals the native view into the primary transcript anchor, avoiding recursion of the same conversation factory. History opens with a durable parent/child address. New reviews record a native child descriptor without granting generic child continuation authority. Older reviews without descriptors remain readable through the compatibility endpoint; viewing never edits history or dispatches a model.

Active processes expand by default and collapse when settled. An explicit fold remains in effect across streaming remounts during that activity; starting another activity restores the default. This bounded UI preference is cleared on plugin unload, not written into task history. Historical Sessions are retained only while expanded. Queued jobs wait for the review Session to exist; reading history never launches a model. Refresh reconstructs the same job and retries do not create a second card.

Collapsed headers retain the review kind, node title and status. Native DSH disclosure controls and theme colors distinguish activity, recovery, faults, invalidation and verdicts. Failed jobs show a localized reason. If the current task permits retry, its summary includes Retry review. Historical faults do not expose current-task actions. Expanding still shows the original error.

## Implementation and verification

Step one connects the native conversation node. Step two distinguishes queuing, response generation, evidence reads, checks and decision application, showing the current tool, last record age and deadline. Failed tools are not successful reads. Outstanding parallel calls remain visible until settled.

Actual Turn events determine whether the primary Turn ended. During review, the DAG dock no longer presents a prior node verdict as current activity. Sidebar links locate the same review job in the primary transcript. The legacy JSON endpoint remains compatible but is not the primary viewer.

Outside active review, the DAG labels the earlier outcome Previous review and identifies its node or review kind. Native summaries retain measured duration, fault retries and decision resubmissions. These counts do not mean that the task passed.

## Controller recovery and evidence inheritance

Formal submissions and manual retries persist first and return promptly. Public lifecycle interfaces run review after the primary Turn or command settles. Internal timeouts and recognizable connection faults, request timeouts, rate limits and temporary service errors retry once by default. Authentication, configuration and unknown faults do not loop automatically. Each attempt starts after the old reviewer fully stops, retaining the Session, model, requirements version, node attempt, evidence cutoff and artifact snapshot. Protocol supplements have a separate counter and do not extend the current deadline.

A completed native Turn without a valid decision permits a bounded supplement within the same job. Read errors followed by successful calls do not block it; the original errors remain in the reviewer Session. A final failed read instead retains the actual tool name, result seq and redacted error for recovery. Supplements do not loosen citation eligibility: index summaries and failed calls cannot support a pass.

Version 7 review records preserve the original permit, recovery policy, consumed retries and fault history. Valid execution approval and versions permit automatic continuation; user pauses, disabling, Host restarts, needs-user and old records without permits remain manual. `resumeAfterReviewRecovery: false` retains the result for manual continuation. Recovery does not grant approval; the first plan still follows the original approval policy.

Recovery rebuilds read eligibility from paired successful native reviewer tool results. Actual event seqs, file hashes, read ranges and truncation markers remain authoritative. An index only locates evidence; failed calls and model claims cannot establish citation eligibility. Independent mode retains the check plan, snapshot and phase boundary. Unreliably recoverable old reads require rereading. Artifact changes reject old verdicts. Pauses, disabling and unload interrupt recovery waits; cleanup waits for work to stop and clears timers.

## Configuration

| Setting | Default | Range and meaning |
| --- | --- | --- |
| reviewFaultRetryAttempts | 1 | 0–3 automatic fault retries per job |
| reviewFaultRetryDelayMs | 3000 | 0–60000 ms before retry |
| resumeAfterReviewRecovery | true | Reuse only the original valid execution permit |

Planning and progress review frequencies remain unchanged. No browser executor, PTC timeout or native sandbox changes are introduced. The 0.1.3 release acceptance passed 405 kernel tests with 13 skipped, strict Host/Client types, two Tasks in one official isolated Session, and browser checks of streaming, failures and six unique job nodes after refresh. Independent mode executed snapshot checks and recovered within the same job from one injected 503 and one actual review timeout, then continued. Clean installation and public package checks are recorded in [0.1.3 release acceptance](releases/0.1.3.md).

The subsequent corrected-read and collapsed-summary regression is recorded in [the October 9 diagnosis and acceptance](postmortem/2026-10-09-review-repair.md). It tests log review and native presentation; it does not add an independent executor or publish a replacement package.

[中文](review-experience.zh.md)
