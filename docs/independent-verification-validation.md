# Independent verification development and validation

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

Status: code is integrated and scripted counterexamples pass; real CodeBuddy acceptance is running. Full production acceptance is not claimed.

A scripted reviewer cannot read the main report before durable independent observations. Its container assertion rejects subtraction presented as addition, then unlocks and compares the report. Admission fixtures reject incomplete output, changed artifacts, unverified criteria and static-only runtime acceptance. Infrastructure failures remain separate from task decisions. Native task input and PTC investigation regressions pass.

The first real node review exposed missing subprocess injection; independent commands did not succeed. The test was paused, preserving its reviewer Session and failed calls. Optional service declarations and fault-ending behavior are corrected before real positive/negative checks. The failed run does not count as successful independent execution.

## Native sandbox experiment record

Earlier sandbox work remains on a fork experiment branch, not upstream or a plugin prerequisite. macOS strict-policy and SDK adapter experiments encountered kernel exit waiting that SIGKILL did not immediately clear; those processes are not successful cleanup evidence. The plugin now uses the container runtime above. Earlier native tests do not substitute for this path's acceptance.
