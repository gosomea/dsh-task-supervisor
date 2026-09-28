# Independent verification development and validation

## Completed-task repair authorization regression

On 2026-09-28 an independent sub-agent reproduced a native write before any repair proposal. Completed-task admission now grants no implementation before a proposal, while pending, after decline, with supervision disabled or after cold recovery. A user-confirmed reopening or explicitly approved new task restores normal implementation. Planning PTC investigation still uses native permissions.

The independent TMP negative fixture passed with denial and unchanged-file assertions. New regressions exercise native write/edit, an unknown executor, diagnostic reads, ordinary questions, new tasks and writes after click confirmation. Cold recovery of a declined proposal still rejects writes. With colima configured, `pnpm test:kernel spikes/kernel/supervisor.spec.ts` passed 73 tests; Host/Client strict checks and build passed. The sub-agent independently checked six focused cases and the original negative fixture. No new real-model requests were sent.

This is tool admission, not protection against external writers or isolation of old files after explicit clear or new-task creation. Ordinary browser journeys, autonomous long tasks and the enhanced repair integration remain unaccepted.

## Isolated Web UI recheck

Repair commit `d17eb5c` was deployed to the registered instance at 58331 after all eight Sessions were idle. Only its independent plugin copy and Host were refreshed; native Session, review and completion state remained. Deployed bundles match the local build byte for byte. A separate headless Chrome profile and fresh authenticated context opened existing positive and negative cases through normal clicks, without model messages or simulated repair confirmation.

The positive main Session renders exactly one native `/task new` user bubble and unchanged native assistant text. Its overview and details both show 1/1 passed. Normal buttons open details and the repair form; after closing the form, state remains complete/revision 8 with zero repair proposals. Details/consultation tabs switch and load the native composer. The negative case shows a user decision and 0/1 with the same node; the independent API returns paused and reviewFault=null. The UI does not label this product defect as an internal failure or completion.

Screenshots: [native task input](assets/independent-native-task-new-bubble.png), [completed details](assets/independent-completed-task-detail.png), [defect decision](assets/independent-paused-defect-detail.png). The [sanitized machine summary](independent-ui-validation-20260928.json) records states, screenshot hashes and limitations. The owned browser process group exited; 58331 remains available for user verification. Daily Chrome debugging, 59909/61454 and the frozen public evaluation were unchanged.

This verifies supervisor Web UI against durable state, not reviewer-owned independent browser execution. Game startup, saved state, water interaction and autonomous long tasks remain outside this run; steps 4–5 are still unaccepted.

## Step 2: artifact snapshots and plugin-owned check runtime

Status: the plugin runtime foundation is validated. DSH keeps its existing extension-record seam baseline without new sandbox fields. User deployments and the frozen public runner remain unchanged. Step 3 owns model integration status.

Snapshots capture the actual tree, including uncommitted and untracked files. Only `.git` is excluded by default; exclusions and file/byte limits are explicit. Pre/post manifests must agree, with two retries for races. External links, links into excluded content and special files fail. Read-only baseline and writable copy have separate inodes. Original changes invalidate acceptance; modifying captured source cannot validate the original artifact.

The plugin uses existing DSH subprocess to operate local Docker. Administrators select a local Unix context, cached immutable image and resource limits. The plugin does not pull images, start VMs or replace the main Agent sandbox. Each check mounts only its check directory, with no network, read-only root, dropped capabilities, no privilege escalation, host UID/GID and private HOME/TMP/cache. Original workspace, baseline, credentials and Docker socket are not mounted. The image must provide `/usr/bin/timeout` and the required toolchain.

Structured argv is not assembled into a shell command. Native process settlement and verified daemon-side container removal precede publication. Durable name, endpoint and snapshot-label records support interrupted-resource recovery. An in-image deadline still bounds work after Host exit. Cleanup requires matching identity rather than guessed names or ports.

Results separately record exit code, timeout, cancellation, output completeness and source changes, plus image, context and container name. Docker reports numeric exit codes; `signal` remains null rather than inventing an OS signal. Missing isolation/toolchain or failed cleanup is infrastructure failure, never task acceptance.

### Executed checks

| Check | Result and scope |
| --- | --- |
| Snapshots | Four passing cases cover untracked files, separate copies, changed originals, internal links, external/excluded links, limits and paths. |
| Real container checks | Five passing cases cover copy writes, unavailable source/credentials, network isolation, source mutation, actual command timeout, literal argv and detached-child cleanup. |
| Interrupted-resource recovery | One passing case simulates a durable interrupted container, removes the exact owned resource and persists a recovery receipt. This is not a complete Host-crash experiment. |
| Native baseline | Existing seam checkout rebuilt without experimental sandbox fields. |
| Types and bundle | Strict Host/Client checks and plugin build pass; no new sandbox dependency. |

Checks use separate `colima`, an immutable Node 24 image, one CPU, 512 MiB and 64 pids; the frozen Rosetta evaluation context is untouched. Check storage is in a VM-visible private cache path while case workspaces are created in TMP. A TMP path invisible to the VM cannot be used as a bind source; deployment storage is explicit.

## Step 3: two-stage model review

Status: integration and real positive/negative cases pass. Independent checks are opt-in for node and completion reviews. Plan coverage and progress remain log-based. Independent browser checks remain step 4; these command checks do not validate the game user journey.

Initial tools expose objective, criteria, scope and snapshot; main reports, Session logs, worker logs and previous conclusions remain locked. The reviewer reads artifacts, writes probes, executes the copy and reads both complete output streams. Durable `task_review_observations` unlocks comparison. Final decisions cover every criterion with this job's inspected evidence. Failed/unverified criteria cannot pass, runtime criteria require independent execution, and visual criteria cannot use static/command evidence as a substitute.

Jobs bind task/version, node attempt, Session cutoff, effective model and artifacts. Task record 11, review record 2 and projection cache 12 read historical formats without rewriting logs or inventing prior checks. Protocol repair preserves snapshot, Session and cutoff; comparison cannot rewrite independent observations. Infrastructure failures end the turn and use fault recovery instead of repeated unavailable checks until the total deadline.

### Acceptance

| Case | Independent evidence and result |
| --- | --- |
| Scripted misleading report | Report remains locked; independent assertion rejects subtraction presented as addition, then comparison unlocks; revise. |
| Real defective implementation | Main `session-cb918f05-ae67-43b2-9dbe-d026741a129c`; original test exits 0, independent probe finds five of nine sum cases fail. Reviewer `task-review-8fc2066e-7966-43f2-9320-777169a32a49` records c1 failed before reading the report. Repair is forbidden by the user, so needs-user pauses without passing the node or completing the task. |
| Real correct implementation | Main `session-30fe3c7d-58d2-4198-8993-95cee7b88d7f`; reviewer `task-review-337e5839-408d-4499-a8aa-555084a7caeb` independently runs original tests and its own positive/negative/zero/boundary assertions. Node passes; a fresh completion snapshot and independent checks pass; task completes. |
| Native input | Exactly one original `/task new …` user message in the positive case. Pre-approval bash/glob/read succeeds; native PTC run_code has a separate regression. Main replies retain native rendering. |
| Artifact/status checks | No source mutation, timeout or incomplete output in successful checks; original fixture contents remain intact. |

Main and reviewer use the daily first CodeBuddy `deepseek-v4.1-flash`. Each case receives one initial approval with automatic continuation disabled; one explicit message requests positive completion after node acceptance. Negative recovery follows the initial service failure, retaining its old failed job and tools. These are development checks, not frozen-public scores or automatic-repair evidence. See [sanitized machine evidence](independent-verification-evidence-20260928.json).

The first real node review lacked subprocess access and recorded 28 tool errors without independent command execution; that failed job remains. The final plugin explicitly queries existing services only when checks are enabled instead of requiring them for all installations. Missing services end review with an infrastructure fault. A real restricted plugin context tests access, and disabled-enhancement cases retain loading.

All 122 kernel checks plus one new focused same-snapshot recovery case, strict Host/Client checks, build and package inspection pass. The package contains only two bundles, patch, READMEs and manifest. An additional real restricted-context container check passes after the service-access correction. Registered instance 58331 holds this work; active user instance 59909 is neither restarted nor replaced.

## Native sandbox experiment record

Earlier sandbox work remains on a fork experiment branch, not upstream or a plugin prerequisite. macOS strict-policy and SDK adapter experiments encountered kernel exit waiting that SIGKILL did not immediately clear; those processes are not successful cleanup evidence. The plugin now uses the container runtime above. Earlier native tests do not substitute for this path's acceptance.
