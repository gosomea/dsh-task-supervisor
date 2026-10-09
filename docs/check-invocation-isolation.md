# Independent copies for check commands

The 2026-10-09 long-horizon development run exposed a runner defect: a CLI created `report.json` in the isolated check tree, which invalidated subsequent checks and decisions on the same snapshot. The original run was stopped and collected as an infrastructure fault, with reward `null`. It was not redelivered. None of the 24 formal positions has been delivered. [中文](check-invocation-isolation.zh.md).

## Change

Each command receives a fresh writable copy of the validated snapshot seed and reviewer probes. Only that invocation is mounted. The seed, control records, source workspace, credentials and Docker socket remain outside the command mount.

- Modified, removed or replaced captured deliverables remain in `changed` and cannot support acceptance.
- New paths are recorded in `generated` alongside `isolation: fresh-copy`. Path metadata does not grant evidence-read eligibility. Reviewers must read actual stdout and stderr and assess assertion coverage.
- Generated reports, caches and probe-directory changes do not carry into later commands. A producer and its output assertions must run together in one probe.
- Legacy records retain their semantics. Historical `changed` evidence is not promoted. Source freshness and two-stage review isolation remain enforced.
- Invocation cleanup follows confirmed container removal. Lost acknowledgement retains the copy and durable container identity. Recovery only cleans resources bound to the snapshot.

## Executed checks

All 22 real Docker/native-subprocess checks passed, including generated reports followed by another check, captured-file modification, probe poisoning, source and network confinement, timeout, cancellation, cleanup and restart recovery. Snapshot and decision-admission regressions also cover new reports and modified-source rejection. Strict Host and Client type checks passed.

The real-model revision fixture still requires a new clean position using the new frozen package. These runner checks do not establish complete workflow success, official scores or a long-horizon advantage.
