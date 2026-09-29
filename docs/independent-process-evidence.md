# Process evidence for independent reviews

## Status and rationale

This is a pending plugin contract. The [real calibration](../eval/deepswe/control-independent-calibration-20260929-1.json) on 2026-09-29 exercised independent file reads, checks and observation before comparison, but did not complete node or final review. Its check directory excludes `.git` and the main executor's `/eval/node24`. Passing tests under another Node does not prove the exact main invocation; correct working files do not prove they were committed.

A missing program or invalid directory permits corrected calls. Modified check copies, lost container identity or uncertain native cleanup still block acceptance. Error classification does not fabricate missing process evidence. Formal tasks retain their Git submission requirements and admission stays closed.

## Implemented administrator API

`dsh-task-supervisor/process-provenance` exposes a process-local administrator API. Strict schemas bind world, review scope and process receipts. Scopes include task and plan versions, node attempt, evidence cutoff and artifact digest; worlds identify an exact container, administrator lease and deadline.

Receipts use exclusive creation and durable flush. Reads check a trusted seal, complete scope, world identity and storage-directory identity. Invalidated scopes retain their old receipts without admitting them to current decisions. Restart recovery requires receipt IDs and digests from trusted deployment storage; it never discovers arbitrary JSON as authoritative evidence. Unsupported capture persists `unavailable`, not successful evidence.

This API is not a model tool and is not connected to the current evaluation instance. An administrator deployment must still implement independent identity checks and capture barriers. Permissions and hashes do not isolate a model with administrator filesystem access. The current main Host and model execution share one container and filesystem authority, so a readable socket, Session string or configuration secret cannot authenticate the controller. A future model reader needs a public projection rather than the complete private world.

Thirteen keyless tests cover durable recovery, foreign task/artifact bindings, changed container identities, tampered receipts, capture invalidation, concurrent duplicate restoration, replaced storage and expiry during asynchronous checks. They validate the receipt API, not native Docker capture or real model acceptance.

## Three evidence types

| Type | What it proves | Source |
| --- | --- | --- |
| Artifact | Current implementation, behavior and constraints | Immutable snapshot, complete file reads, independent checks and outputs. |
| Git process | Commit identity, parents, clean state and correspondence between committed content and current artifacts | Administrator capture and receipts calculated independently with trusted Git. |
| Execution process | Actual executable, arguments, directory, outcome and artifact version | Receipts from the trusted native process execution boundary. |

Main-Agent summaries and shell input are investigative leads, not proof of commits or execution. Matching version strings do not prove matching binaries. Independent runs should report artifact and process coverage separately; absent evidence remains `unverified`.

## Plugin contract

Reuse the administrator gateway and private storage without modifying DSH's native sandbox. Models read receipts for the bound task; they cannot select main containers, host paths, Git HEADs or administrator commands. Receipts bind task version, node attempt, snapshot ID and artifact digest, exact main-container identity, evidence cutoff and capture time.

The current check request's `sessionId` is client-supplied recording metadata, not authorization for new process receipts. A trusted launcher first registers the execution world: Docker daemon, exact container ID and owner label, cwd, main Session and lease. The task controller then binds task version, node attempt, cutoff and artifact digest. Models reference an opaque binding ID only. The administrator validates identity and does not accept arbitrary client-uploaded success receipts. The receipt-producing channel or capability remains separate from the model-accessible check socket.

The native `subprocess.spawn` returns a managed handle without general spawn audit events. Cordis `intercept` merges configuration rather than intercepting process methods. Shell execution generally exposes only `bash -c`; PTC's inner `child_process` calls and dynamic imports also bypass the directly visible boundary. The first implementation therefore registers a structured main-verification tool, declaring `coverage=top-level-direct`, using native spawn, done, output collection and waitForExit. It cannot attest to arbitrary shell/PTC nested execution. Resolved binary paths also need actual file digests and frozen read-only binaries/dependencies to prevent replacement between hashing and launch.

Capture Git only after managed writers settle, checking HEAD and working-tree digest before and after capture. An administrator private copy independently calculates committed content, parent relationships and tracked/untracked status. Repository hooks, aliases, external diff, filters and configuration must not execute: arbitrary repository Git configuration cannot be trusted in the administrator environment. Keep `.git` outside ordinary model-writable check directories; do not export credentials, authenticated remotes or full history. Tasks without Git receive an explicit unavailable status.

Execution receipts originate at the boundary that actually starts programs, recording the resolved binary digest, structured argv, cwd, start/end times, exit outcome and output digest. A `sh -lc` string does not prove each nested program ran. Unobservable nested execution must remain a coverage limitation; when needed, provide a plugin-owned structured verification tool rather than manufacturing successful receipts from shell text.

Independent re-execution uses the same administrator-selected frozen runtime. Read-only executable mounts and their dependency closure belong in the release. Past main execution and successful independent re-execution have separate receipts and cannot substitute for each other. Models do not choose runtime configuration.

A proposed `inspect_task_provenance` tool pages bound receipts and returns stable evidence IDs. Acceptance checks evidence domain, version, complete reads and current artifact binding: Git criteria cannot cite README files, and execution-process criteria cannot cite only a version string. The existing artifact-observation-before-main-report gate remains. Administrator process receipts can be independently inspected but must not contain the main Agent's success summary.

## Implementation and validation order

1. Define receipt schemas and applicable criteria, separating artifact behavior, Git submission and actual main execution.
2. Implement administrator capture, consistency checks and private persistence. Keyless tests cover dirty/untracked files, post-commit changes, external Git configuration and incorrect container identities.
3. Add the read-only tool and deterministic acceptance validation, rejecting foreign, stale, partially read or differently bound receipts.
4. Validate effective node and completion decisions in a new calibration Session, then freeze the formal release. Retain the failed Session without rescue prompts or deadline changes.

Real negative cases include correct but uncommitted files, commits that differ from current files, different binaries with equal version strings, shell claims without execution and writes during Git/artifact capture. Formal delivery of the 16 positions follows validated evidence, not merely working artifact checks.
