# Planning supervision validation

English | [简体中文](planning-supervision-validation.zh.md)

## Truncation recovery

Native Agent-loop regressions cover planning continuation after truncation, waiting for manual approval after submission, pausing repeated recovery without new facts, and disabled automatic continuation. Assertions inspect actual `turn/end` and native user-message IDs rather than internal return values alone. Recovery classification and complete Supervisor regressions passed 108 tests, with one existing Docker-conditional case unrun; strict Host/Client checks and build passed. Delivery regressions also cover second-flush failure and user pause during delivery, withdrawing the exact queued input before native maintenance can wake the driver; disabled continuation retains manual planning resume.

Task record version 12 follows 11; projection state version 13 follows 12. Optional `recovery` retains the original turn, ending seq, no-progress count, evidence seqs, tool-output fingerprint, message ID and continuation text. `pauseReason` adds `recovery-stalled`. Versions 1–11 remain readable without invented recovery facts; readers without version 12 admission refuse to drive rather than ignoring control state.

Pending input and its task snapshot are saved durably before delivery through native maintenance and another flush. Recheck state revision and inbox before delivery; failures disarm. Restart removes old plugin input and waits for manual resume instead of redelivering from an old ending event. Checks use isolated Session storage without changing daily profiles or the frozen evaluation.

An isolated real-model case used the daily first CodeBuddy route (`deepseek-codebuddy/deepseek-v4.1-flash`) with a labelled 256-token test cap. Session `session-ba240d3b-b5fe-4da6-9a72-2e6441a3b387` ended at seq 19/28/37 with native `max-tokens`; two distinct continuation inputs were persisted at seq 20/29 and consumed once each at seq 25/34. With no tool facts, seq 38 paused with `recovery-stalled` and count 2. There was no manual rescue, approval or workspace write. This case proves real truncation and bounded recovery, not successful plan submission; scripted native-loop tests cover submission and manual-approval waiting. Private evidence remains in the registered TMP environment `supervisor-planning-recovery-20260929`; its candidate preceded the final flush-race/manual-resume fixes, which were independently reproduced and verified with deterministic native-loop regressions.
