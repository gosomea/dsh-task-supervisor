"""OpenSandbox adapter. Imported only when a real probe or baseline runs."""

from datetime import timedelta

from runtime import SandboxRef, SnapshotRef


SDK_VERSION = "1.1.0"


class OpenSandboxRuntime:
    def __init__(self, *, domain: str, api_key: str | None, protocol: str, use_server_proxy: bool) -> None:
        from opensandbox.config import ConnectionConfigSync
        from opensandbox.sync.manager import SandboxManagerSync

        self._config = ConnectionConfigSync(
            domain=domain, api_key=api_key, protocol=protocol, use_server_proxy=use_server_proxy,
        )
        self._manager = SandboxManagerSync.create(self._config)
        self._boxes = {}

    def create(self, *, image: str | None, snapshot_id: str | None, metadata: dict[str, str],
               network_policy: str = "deny", timeout_minutes: int = 20,
               cpu: str = "1", memory: str = "2Gi") -> SandboxRef:
        from opensandbox.models.sandboxes import NetworkPolicy
        from opensandbox.sync.sandbox import SandboxSync

        if network_policy not in {"allow", "deny"}:
            raise ValueError("network_policy must be allow or deny")
        sandbox = SandboxSync.create(
            image,
            snapshot_id=snapshot_id,
            connection_config=self._config,
            metadata=metadata,
            network_policy=NetworkPolicy(default_action=network_policy),
            timeout=timedelta(minutes=timeout_minutes),
            ready_timeout=timedelta(seconds=120),
            resource={"cpu": cpu, "memory": memory},
        )
        self._boxes[sandbox.id] = sandbox
        return SandboxRef(sandbox.id)

    def write(self, sandbox: SandboxRef, path: str, data: bytes, mode: int = 644) -> None:
        from opensandbox.models.filesystem import WriteEntry

        self._boxes[sandbox.id].files.write_files([WriteEntry(path=path, data=data, mode=mode)])

    def read(self, sandbox: SandboxRef, path: str) -> bytes:
        return self._boxes[sandbox.id].files.read_bytes(path)

    def exec(self, sandbox: SandboxRef, command: str, *, timeout_s: int | None = 120, background: bool = False,
             envs: dict[str, str] | None = None) -> tuple[int | None, str, str]:
        from opensandbox.models.execd import RunCommandOpts

        result = self._boxes[sandbox.id].commands.run(
            command,
            opts=RunCommandOpts(
                timeout=None if timeout_s is None else timedelta(seconds=timeout_s),
                background=background, envs=envs,
            ),
        )
        stdout = result.text
        stderr = "\n".join(message.text.rstrip("\n") for message in result.logs.stderr)
        return result.exit_code, stdout, stderr

    def endpoint(self, sandbox: SandboxRef, port: int) -> str:
        return self._boxes[sandbox.id].get_endpoint(port).endpoint

    def create_snapshot(self, sandbox: SandboxRef, name: str) -> SnapshotRef:
        box = self._boxes[sandbox.id]
        box.renew(timedelta(minutes=20))
        info = box.create_snapshot(name=name)
        return SnapshotRef(info.id, info.status.state, info.status.message)

    def get_snapshot(self, snapshot_id: str) -> SnapshotRef:
        info = self._manager.get_snapshot(snapshot_id)
        return SnapshotRef(info.id, info.status.state, info.status.message)

    def detach(self, sandbox: SandboxRef) -> None:
        """Forget a sandbox without destroying it. The caller keeps it running."""
        self._boxes.pop(sandbox.id, None)

    def destroy(self, sandbox: SandboxRef) -> None:
        box = self._boxes.pop(sandbox.id, None)
        if box is None:
            return
        box.destroy()

    def close(self) -> None:
        for sandbox in list(self._boxes):
            self.destroy(SandboxRef(sandbox))
        self._manager.close()
