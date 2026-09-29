# Planning supervision validation

English | [简体中文](planning-supervision-validation.zh.md)

## Truncation recovery

Native Agent-loop regressions cover planning continuation after truncation, waiting for manual approval after submission, pausing repeated recovery without new facts, and disabled automatic continuation. Assertions inspect actual `turn/end` and native user-message IDs rather than internal return values alone. Recovery classification and complete Supervisor regressions passed 108 tests, with one existing Docker-conditional case unrun; strict Host/Client checks and build passed. Delivery regressions also cover second-flush failure and user pause during delivery, withdrawing the exact queued input before native maintenance can wake the driver; disabled continuation retains manual planning resume.

Task record version 12 follows 11; projection state version 13 follows 12. Optional `recovery` retains the original turn, ending seq, no-progress count, evidence seqs, tool-output fingerprint, message ID and continuation text. `pauseReason` adds `recovery-stalled`. Versions 1–11 remain readable without invented recovery facts; readers without version 12 admission refuse to drive rather than ignoring control state.

Pending input and its task snapshot are saved durably before delivery through native maintenance and another flush. Recheck state revision and inbox before delivery; failures disarm. Restart removes old plugin input and waits for manual resume instead of redelivering from an old ending event. Checks use isolated Session storage without changing daily profiles or the frozen evaluation.

An isolated real-model case used the daily first CodeBuddy route (`deepseek-codebuddy/deepseek-v4.1-flash`) with a labelled 256-token test cap. Session `session-ba240d3b-b5fe-4da6-9a72-2e6441a3b387` ended at seq 19/28/37 with native `max-tokens`; two distinct continuation inputs were persisted at seq 20/29 and consumed once each at seq 25/34. With no tool facts, seq 38 paused with `recovery-stalled` and count 2. There was no manual rescue, approval or workspace write. This case proves real truncation and bounded recovery, not successful plan submission; scripted native-loop tests cover submission and manual-approval waiting. Private evidence remains in the registered TMP environment `supervisor-planning-recovery-20260929`; its candidate preceded the final flush-race/manual-resume fixes, which were independently reproduced and verified with deterministic native-loop regressions.

## Planning formation review

Task records add version 13 and projection version 14; review records admit version 3 for the new `planning` kind. Old logs remain readable without fabricated summaries. Bound reviewers must read original Session evidence and successfully submit a structured planning decision; no artifact runner or DAG node is invented before submission. Native-loop regressions cover investigation observed before plan submission, manual approval waiting, needs-user, semantic stagnation and internal protocol faults. Idle continuation reinspects only a newer native ending, including a short round finishing during admission cleanup.


The complete kernel suite passed 275 tests, with 13 platform/Docker conditional checks unrun; Host and Client strict checks and build passed. A further native downstream-hook barrier regression covers a user pause after the finding was applied but before request admission: no stale steering or new model request is delivered. User-facing detail distinguishes planning facts, unresolved questions, next output and semantic stagnation from internal review faults.

The first real planning-formation case used candidate `5f4a4b5a…` and Session `session-04fc193c-8950-4127-879c-be2f6250bbaf`. Its first review rejected mere glob results as file-content evidence, followed by actual reads and applied planning findings. Eight planning jobs were recorded: seven applied, then one protocol-missing fault paused the task with no rescue. It did not reach approval: a proposed post-approval read turn repeatedly hit the empty default read-tool gate. The plugin now defaults that explicit gate to native read/glob/grep (without restricting planning tools); a regression verifies admission. A new fixed-version case is kept separate from this failure. This case establishes real pre-submission supervision and fault preservation, not full workflow success.

A separate fixed candidate `546a63a6…` in Session `session-0caee3a7-a20f-42f1-8f6d-9313fdc0cfd9` applied three planning reviews, rejected a misclassified project-source criterion, then submitted a corrected plan at seq 57. Its coverage reviewer `task-review-a2562578-8b07-4223-b6d0-04e557fb2246` reached native max-tokens at reviewer seq 40 without a decision. The task paused as review-fault with no writes, approval or manual rescue. This exposed the prior completed-only supplementation boundary; the third batch admits settled reviewer truncation under the same existing repair limit and deadline. Neither failed candidate is overwritten or rescued.

Both planning probes above deliberately used an 8192-token test cap. The daily first CodeBuddy model uses maxTokens=32000 with provider-default reasoning; the daily native request header and composed first-model configuration agree. The capped failures do not establish a daily-configuration failure. Private raw evidence stays outside Git.

## Preauthorized execution and reviewer supplementation

Native-loop regressions cover exact durable policy grants, forced formal coverage, pass/revise/needs-user/internal-fault outcomes, edited requirements, competing manual approval, full stage/completion flow, and revocation during an active reviewer request. Pure authorization tests reject fake user messages, old schema records, cross-Session forks and mismatched review inputs. A blocked reviewer revocation test reads back the manual grant from persistence and observes no active transition or implementation.

Reviewer boundary tests require the latest actual max-tokens request and closed obligations. Supplementation preserves the Session, cutoff, requirements, read evidence and original deadline; limits 0/1/2, pending or declared tools, stale max markers, later effects, cancelled/error/blocked endings and evidence-read failures are covered. Only a durable structured decision is effective.

The final source passes 334 kernel tests across 23 files, with 13 existing platform/Docker conditional checks unrun. Host and Client strict typechecks, build, declared package-entry inspection, bilingual line/link checks and whitespace checks pass. Authorization adds task record 14 and projection 15; legacy logs do not receive invented grants.

## Daily-configuration real workflow

The fixed control-flow candidate is SHA256 `c811bb3e0bfe5cf9f331ee0268089e1ee9636951aea7dea1e43dfb6a62a8061c`. The final source bundle SHA256 is `055a8632005ee3e7cbb9af1a7604510b77bdec2a724bcf2ec443a45c85ee970a`; its only later runtime change distinguishes artifact-verification obligations from ordinary log-review obligations in supplementation prompts. Running cases retain their fixed candidate.

The manual case uses Session `session-b019a771-85f7-4ae5-8ea3-ec3a2e99b90c`, task `351b2bc4-f657-4c15-8e2b-9f68a0ddda7d`. It applies planning reviews at cutoff 22/35 and a formal plan review at cutoff 44, then reaches revision 4, planVersion 1, awaiting-approval. The workspace hashes are unchanged, the Host is idle and no approval or rescue was sent. This proves real planning supervision followed by manual-approval waiting.

The real request headers use the daily first CodeBuddy route, maxTokens=32000 and no reasoning-effort override. Manual planning observation uses a labelled one-tool threshold to exercise the boundary; model parameters and the existing 600000ms log-review deadline are not lowered. These workflow cases do not enable independent artifact verification or Docker, and do not establish reviewer-independent runtime execution.

The preauthorized case uses Session `session-18e4e1c6-ddd0-4d48-b597-c72f66cad777`, task `7d370f78-8caa-4968-b4ab-f8087489f7f3`. Planning reviews at cutoff 23/36/47 and formal plan review 56 pass. The policy approval at main seq 62 references grant seq 4 and plan-review job `8602bb22-8088-4dd6-9060-e85e4c7bdbb5`, before node start 79 and edit 85. Stage 98 and completion 116 pass; the task finishes at revision 13, planVersion 1. No manual approval, rescue or replay is sent.

After completion, a separate Node 24 process asserts double(0)=0, double(3)=6 and double(-2)=-4, with exit 0. Only the entry file changes; README remains unchanged. This is an external smoke-test oracle, not a claim that a reviewer executed independent artifact checks. Both daily-configuration cases finish reviews on attempt 1 without truncation: real reviewer supplementation remains unproven, while the native-loop positive and negative regressions cover that protocol.

Browser interaction is untested in this run. The browser-harness daemon is unavailable, the available Edge connection blocks the test navigation with ERR_BLOCKED_BY_CLIENT, and no in-app-browser connection is exposed. No security policy or cookies are changed. Client type/build and native API/storage checks do not substitute for clicking the new controls.

The registered isolated deployment is `supervisor-planning-recovery-20260929`, port 56017. Cases use fresh automatically bound TMP workspaces. After sealing them, the retained deployment uses the final bundle, default observation thresholds 24/5min/3errors and manual profile approval, with daily model settings. The two cases used a labelled one-tool observation overlay; retained task histories are unchanged. User Hosts 58331/61454 and the frozen public evaluation are untouched. Safe machine evidence is in [the validation summary](planning-supervision-validation.json); private raw logs and authenticated URLs stay outside Git.
