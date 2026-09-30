# Post-repair Kea development validation

## Summary

The new `707261f` position seals with official reward 0, F2P 0/12 and P2P 139/139. Formal-plan decisions now complete, but the runner sends approval again during native preauthorization preparation, causing a gateway collision and empty-patch sealing. Repairs and subsequent validation remain separate from this result.

## Run protocol

The [freeze record](kea-postfix-80g-run.json) pins the model, original instruction, runtime, runner, plugin, profile and image. One initial execution preauthorization, a 10800-second deadline and sealing without rescue apply; only the Agent’s committed patch is graded. No failure hints, hidden tests or live version changes are delivered; this is an exposed development regression, not unseen comparative evidence.

## Preparation fault and recovery

The first new position hits `ENOSPC` during independent capability preparation. Its original Session has no model steps or actual HTTP requests and no created task. Task and check-administrator containers stop with acknowledged cleanup. The [fault result](kea-postfix-preparation-fault.json) and [original position](kea-postfix-run.json) are not replaced.

The evaluation Docker VM’s 60 GiB data disk is full while inodes remain available. After confirming no containers run in that VM, its data disk and ext4 filesystem grow to 80 GiB with about 17 GiB free; 4 CPUs and 8 GiB memory remain unchanged. Old containers, images, volumes and evidence are retained. A new Home and Session are allocated and frozen before delivery. Expansion is an infrastructure change, so the two positions are not identical-condition repeats.

## Official result and protocol defect

The [sealed result](kea-postfix-80g-result.json) retains all 151 official test results. Elapsed time is 1517.435 seconds, review wait 851047 milliseconds and reviewer tool calls 116; no internal review timeout occurs, and independent artifact acceptance is not reached. All Sessions report tokens: 269359 uncached input, 251254 output, 2763776 cache-read and 0 cache-write. Rechecked frozen inventories all match.

Three planning observations pass; the first formal plan is returned for missing enabled-mode lifecycle checks and stable-identity acceptance, and the second formal plan passes. The revision concerns explicit original requirements rather than new preferences; its unannotated correction-benefit metric remains null.

The plan tool at main Session seq 194 is unsettled when seq 198 publishes `awaiting-approval`; the plugin then performs native approval preparation. About 6 seconds later the runner sends `/task approve` at seq 200, and seq 201 returns gateway busy. The runner seals and stops native preparation. This establishes repaired formal decision transport, not the effectiveness of new artifact inspection.

## Adapter repair and validation

The runner now recognizes native `after-review` authorization scoped to the current requirements and sends no manual approval during preparation. After approval applies, it checks the main Session, requirements version, authorization sequence, plan version and passing review job and records an observation receipt only; it creates no user message or additional approval. The legacy manual path still sends once; identity mismatch faults rather than falling back to another approval.

42 control-flow tests and 5 metrics tests pass. Race fixtures cover pending preparation, recording applied approval once, observing receipts after completion and rejecting wrong authorization/review identities. A [real Session replay](policy-observer-replay.json) matches the completed static task’s native authorization, plan and review ID with 0 manual commands; this is not a new model run.

A subsequent frozen position validates the repair. The original reward 0 and this reward 0 remain unchanged; sealed Sessions are not resumed. The user-validation instance on 56085 remains running. Capability coverage, false acceptance and false pause metrics without blind annotations remain null.
