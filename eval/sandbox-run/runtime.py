"""Sandbox operations the evaluation runner needs. Adapters live beside this file."""

from typing import Protocol


class SandboxRef:
    def __init__(self, sandbox_id: str) -> None:
        self.id = sandbox_id


class SnapshotRef:
    def __init__(self, snapshot_id: str, state: str, message: str | None = None) -> None:
        self.id = snapshot_id
        self.state = state
        self.message = message


class Runtime(Protocol):
    def create(self, *, image: str | None, snapshot_id: str | None, metadata: dict[str, str]) -> SandboxRef:
        """Start one sandbox from an image or a snapshot. Exactly one source is set."""

    def write(self, sandbox: SandboxRef, path: str, data: bytes) -> None:
        """Create or replace one file."""

    def read(self, sandbox: SandboxRef, path: str) -> bytes:
        """Read one file."""

    def create_snapshot(self, sandbox: SandboxRef, name: str) -> SnapshotRef:
        """Capture the running sandbox. The returned state may still be Creating."""

    def get_snapshot(self, snapshot_id: str) -> SnapshotRef:
        """Read the current snapshot state."""

    def destroy(self, sandbox: SandboxRef) -> None:
        """Terminate the sandbox. The snapshot, if any, remains."""
