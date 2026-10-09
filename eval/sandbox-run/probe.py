"""Model-free snapshot probe and the first-case filesystem baseline."""

import hashlib
import time
from pathlib import Path

from runtime import Runtime, SandboxRef


MARKER_PATH = "/tmp/sandbox-run-marker"
CASE_ROOT = Path(__file__).resolve().parents[1] / "long-horizon-dev-v1" / "fixtures"
WORKSPACE = "/workspace"


class ProbeError(RuntimeError):
    pass


def wait_snapshot(runtime: Runtime, snapshot_id: str, *, timeout_s: float, sleep, monotonic) -> None:
    deadline = monotonic() + timeout_s
    last = "Creating"
    while True:
        current = runtime.get_snapshot(snapshot_id)
        last = current.state
        if current.state == "Ready":
            return
        if current.state == "Failed":
            raise ProbeError(current.message or f"snapshot {snapshot_id} failed")
        if monotonic() >= deadline:
            raise ProbeError(f"snapshot {snapshot_id} stayed {last}")
        sleep(1)


def _destroy_quiet(runtime: Runtime, sandbox: SandboxRef | None) -> None:
    if sandbox is None:
        return
    try:
        runtime.destroy(sandbox)
    except Exception:
        return


def probe_snapshot(runtime: Runtime, *, image: str, marker: bytes, name: str,
                   timeout_s: float = 120, sleep=None, monotonic=None) -> dict:
    sleep = sleep or time.sleep
    monotonic = monotonic or time.monotonic
    source = runtime.create(image=image, snapshot_id=None, metadata={"role": "probe-source"})
    restored: SandboxRef | None = None
    try:
        runtime.write(source, MARKER_PATH, marker)
        snapshot = runtime.create_snapshot(source, name)
        wait_snapshot(runtime, snapshot.id, timeout_s=timeout_s, sleep=sleep, monotonic=monotonic)
        restored = runtime.create(image=None, snapshot_id=snapshot.id, metadata={"role": "probe-restored"})
        if runtime.read(restored, MARKER_PATH) != marker:
            raise ProbeError("restored sandbox marker does not match")
        source_id = source.id
        runtime.destroy(source)
        source = None
        if runtime.read(restored, MARKER_PATH) != marker:
            raise ProbeError("marker disappeared after the source sandbox was destroyed")
        restored_id = restored.id
        runtime.destroy(restored)
        restored = None
        return {
            "kind": "opensandbox-probe",
            "image": image,
            "snapshotId": snapshot.id,
            "sourceSandboxId": source_id,
            "restoredSandboxId": restored_id,
            "markerSha256": hashlib.sha256(marker).hexdigest(),
        }
    finally:
        _destroy_quiet(runtime, source)
        _destroy_quiet(runtime, restored)


def case_files(case: str) -> dict[str, bytes]:
    root = CASE_ROOT / case
    if not root.is_dir():
        raise ProbeError(f"unknown case: {case}")
    files = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            files[path.relative_to(root).as_posix()] = path.read_bytes()
    if not files:
        raise ProbeError(f"case {case} has no files")
    return files


def prepare_baseline(runtime: Runtime, *, case: str, image: str, name: str,
                     timeout_s: float = 120, sleep=None, monotonic=None) -> dict:
    sleep = sleep or time.sleep
    monotonic = monotonic or time.monotonic
    files = case_files(case)
    source = runtime.create(image=image, snapshot_id=None, metadata={"role": "baseline-source", "case": case})
    restored: SandboxRef | None = None
    try:
        for relative, data in files.items():
            runtime.write(source, f"{WORKSPACE}/{relative}", data)
        snapshot = runtime.create_snapshot(source, name)
        wait_snapshot(runtime, snapshot.id, timeout_s=timeout_s, sleep=sleep, monotonic=monotonic)
        restored = runtime.create(image=None, snapshot_id=snapshot.id,
                                  metadata={"role": "baseline-check", "case": case})
        for relative, data in files.items():
            if runtime.read(restored, f"{WORKSPACE}/{relative}") != data:
                raise ProbeError(f"restored file differs: {relative}")
        source_id = source.id
        runtime.destroy(source)
        source = None
        for relative, data in files.items():
            if runtime.read(restored, f"{WORKSPACE}/{relative}") != data:
                raise ProbeError(f"file disappeared after source destruction: {relative}")
        restored_id = restored.id
        runtime.destroy(restored)
        restored = None
        return {
            "kind": "opensandbox-baseline",
            "case": case,
            "image": image,
            "snapshotId": snapshot.id,
            "sourceSandboxId": source_id,
            "restoredSandboxId": restored_id,
            "files": {relative: hashlib.sha256(data).hexdigest() for relative, data in files.items()},
        }
    finally:
        _destroy_quiet(runtime, source)
        _destroy_quiet(runtime, restored)
