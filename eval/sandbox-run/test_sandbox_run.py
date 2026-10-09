"""Snapshot order and closed intervention actions."""

import hashlib
import json
import subprocess
import sys
import unittest
from pathlib import Path

from policy import Observation, decide, path_inside_workspace
from probe import MARKER_PATH, ProbeError, WORKSPACE, case_files, prepare_baseline, probe_snapshot
from runtime import SandboxRef, SnapshotRef


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


class FakeRuntime:
    def __init__(self, *, ready_after: int = 1, fail: bool = False, drop_on_restore: bool = False) -> None:
        self.ready_after = ready_after
        self.fail = fail
        self.drop_on_restore = drop_on_restore
        self.files: dict[str, dict[str, bytes]] = {}
        self.snapshots: dict[str, dict[str, bytes]] = {}
        self.polls: dict[str, int] = {}
        self.destroyed: list[str] = []
        self.events: list[str] = []
        self._next = 0

    def create(self, *, image, snapshot_id, metadata) -> SandboxRef:
        self._next += 1
        sandbox_id = f"sb-{self._next}"
        self.files[sandbox_id] = {} if snapshot_id is None else dict(self.snapshots[snapshot_id])
        if self.drop_on_restore and snapshot_id is not None:
            self.files[sandbox_id][MARKER_PATH] = b"wrong"
        self.events.append(f"create:{sandbox_id}:{image}:{snapshot_id}")
        return SandboxRef(sandbox_id)

    def write(self, sandbox: SandboxRef, path: str, data: bytes) -> None:
        self.files[sandbox.id][path] = data
        self.events.append(f"write:{sandbox.id}:{path}")

    def read(self, sandbox: SandboxRef, path: str) -> bytes:
        self.events.append(f"read:{sandbox.id}:{path}")
        return self.files[sandbox.id][path]

    def create_snapshot(self, sandbox: SandboxRef, name: str) -> SnapshotRef:
        snapshot_id = f"snap-{name}"
        self.snapshots[snapshot_id] = dict(self.files[sandbox.id])
        self.polls[snapshot_id] = 0
        self.events.append(f"snapshot:{sandbox.id}:{snapshot_id}")
        return SnapshotRef(snapshot_id, "Creating")

    def get_snapshot(self, snapshot_id: str) -> SnapshotRef:
        self.polls[snapshot_id] += 1
        self.events.append(f"poll:{snapshot_id}:{self.polls[snapshot_id]}")
        if self.fail:
            return SnapshotRef(snapshot_id, "Failed", "runtime refused")
        if self.polls[snapshot_id] >= self.ready_after:
            return SnapshotRef(snapshot_id, "Ready")
        return SnapshotRef(snapshot_id, "Creating")

    def destroy(self, sandbox: SandboxRef) -> None:
        self.destroyed.append(sandbox.id)
        self.files.pop(sandbox.id, None)
        self.events.append(f"destroy:{sandbox.id}")


class ProbeTests(unittest.TestCase):
    def test_probe_restores_marker_then_destroys_both_sandboxes(self) -> None:
        runtime = FakeRuntime(ready_after=2)
        clock = Clock()
        marker = b"marker-bytes"
        receipt = probe_snapshot(runtime, image="ubuntu:24.04", marker=marker, name="probe",
                                 timeout_s=5, sleep=clock.sleep, monotonic=clock.monotonic)
        self.assertEqual(receipt["kind"], "opensandbox-probe")
        self.assertEqual(receipt["snapshotId"], "snap-probe")
        self.assertEqual(receipt["markerSha256"], hashlib.sha256(marker).hexdigest())
        self.assertEqual(runtime.destroyed, ["sb-1", "sb-2"])
        self.assertIn("snap-probe", runtime.snapshots)
        destroy_source = runtime.events.index("destroy:sb-1")
        second_read = runtime.events.index("read:sb-2:/tmp/sandbox-run-marker", destroy_source)
        self.assertLess(destroy_source, second_read)
        self.assertLess(second_read, runtime.events.index("destroy:sb-2"))

    def test_probe_destroys_source_when_snapshot_fails(self) -> None:
        runtime = FakeRuntime(fail=True)
        clock = Clock()
        with self.assertRaises(ProbeError):
            probe_snapshot(runtime, image="ubuntu:24.04", marker=b"x", name="probe",
                           timeout_s=5, sleep=clock.sleep, monotonic=clock.monotonic)
        self.assertEqual(runtime.destroyed, ["sb-1"])

    def test_probe_rejects_a_missing_restored_marker(self) -> None:
        runtime = FakeRuntime(drop_on_restore=True)
        clock = Clock()
        with self.assertRaises(ProbeError):
            probe_snapshot(runtime, image="ubuntu:24.04", marker=b"x", name="probe",
                           timeout_s=5, sleep=clock.sleep, monotonic=clock.monotonic)
        self.assertEqual(runtime.destroyed, ["sb-1", "sb-2"])

    def test_baseline_keeps_case_bytes_after_source_destruction(self) -> None:
        runtime = FakeRuntime()
        clock = Clock()
        receipt = prepare_baseline(runtime, case="revision-and-evidence", image="ubuntu:24.04",
                                   name="baseline", timeout_s=5, sleep=clock.sleep, monotonic=clock.monotonic)
        files = case_files("revision-and-evidence")
        self.assertEqual(set(receipt["files"]), {"README.md", "data.csv", "verify.mjs"})
        for relative, data in files.items():
            self.assertEqual(receipt["files"][relative], hashlib.sha256(data).hexdigest())
        self.assertEqual(runtime.destroyed, ["sb-1", "sb-2"])
        self.assertIn(f"{WORKSPACE}/data.csv", runtime.snapshots["snap-baseline"])


class PolicyTests(unittest.TestCase):
    def test_workspace_path_rule(self) -> None:
        self.assertTrue(path_inside_workspace("/workspace/analyze.mjs"))
        self.assertTrue(path_inside_workspace("analyze.mjs"))
        self.assertFalse(path_inside_workspace("/workspace"))
        self.assertFalse(path_inside_workspace("/workspace/../etc/passwd"))
        self.assertFalse(path_inside_workspace("/tests/hidden"))
        self.assertFalse(path_inside_workspace(""))

    def test_closed_actions(self) -> None:
        cases = [
            (Observation(sandbox_path="/workspace/report.json"), "allow-once"),
            (Observation(sandbox_path="/tests/hidden"), "reject"),
            (Observation(phase="awaiting-approval", plan_review_passed=True), "approve"),
            (Observation(phase="awaiting-approval", plan_review_passed=True, approvals=1), "none"),
            (Observation(phase="awaiting-approval", plan_review_passed=False), "none"),
            (Observation(pause_reason="recovery-stalled"), "resume"),
            (Observation(pause_reason="recovery-stalled", recovery_resumes=1), "seal"),
            (Observation(pause_reason="restart"), "resume"),
            (Observation(pause_reason="restart", restart_resumes=1), "seal"),
            (Observation(pause_reason="review-fault", review_fault_retryable=True), "retry-review"),
            (Observation(pause_reason="review-fault", review_fault_retryable=True, review_retries=1), "seal"),
            (Observation(pause_reason="review-fault"), "seal"),
            (Observation(pause_reason="decision"), "seal"),
            (Observation(pause_reason="planning-stalled"), "seal"),
            (Observation(pause_reason="user"), "none"),
            (Observation(phase="active"), "none"),
        ]
        for observation, action in cases:
            with self.subTest(action=action, pause=observation.pause_reason, path=observation.sandbox_path):
                self.assertEqual(decide(observation).action, action)

    def test_decide_cli_reads_observation_json(self) -> None:
        script = str(Path(__file__).with_name("run.py"))
        completed = subprocess.run(
            [sys.executable, script, "decide", "--observation", "-"],
            input=json.dumps({"pauseReason": "planning-stalled"}),
            text=True, capture_output=True, check=True,
        )
        self.assertEqual(json.loads(completed.stdout)["action"], "seal")

    def test_sandbox_request_outranks_approval(self) -> None:
        observation = Observation(phase="awaiting-approval", plan_review_passed=True, sandbox_path="/tmp/outside")
        self.assertEqual(decide(observation).action, "reject")


if __name__ == "__main__":
    unittest.main()
