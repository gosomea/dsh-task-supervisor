"""OpenSandbox adapter. Imported only when a real probe or baseline runs."""

from datetime import datetime, timedelta, timezone

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
        self._owned: set[str] = set()

    def create(self, *, image: str | None, snapshot_id: str | None, metadata: dict[str, str],
               network_policy: str = "deny", timeout_minutes: int = 20,
               cpu: str = "1", memory: str = "2Gi", platform: str | None = None,
               volumes: list[dict] | None = None, native_isolation: bool = True) -> SandboxRef:
        from opensandbox.models.sandboxes import NetworkPolicy, Volume, PlatformSpec
        from opensandbox.sync.sandbox import SandboxSync

        if network_policy not in {"allow", "deny"}:
            raise ValueError("network_policy must be allow or deny")
        platform_spec = None
        if platform is not None:
            parts = platform.split('/')
            if len(parts) != 2 or any(not part for part in parts):
                raise ValueError('platform must be os/architecture')
            platform_spec = PlatformSpec(os=parts[0], arch=parts[1])
        sandbox = SandboxSync.create(
            image,
            snapshot_id=snapshot_id,
            connection_config=self._config,
            metadata=metadata,
            network_policy=NetworkPolicy(default_action=network_policy),
            timeout=timedelta(minutes=timeout_minutes),
            ready_timeout=timedelta(seconds=120),
            resource={"cpu": cpu, "memory": memory},
            platform=platform_spec,
            volumes=[Volume.model_validate(volume) for volume in volumes] if volumes else None,
            # OpenSandbox 1.1.0 documents this bootstrap extension for nested
            # bwrap namespaces. DSH still enforces workspace-write itself.
            extensions={"bootstrap.execd.isolation": "enable"} if native_isolation else None,
        )
        self._boxes[sandbox.id] = sandbox
        self._owned.add(sandbox.id)
        return SandboxRef(sandbox.id)

    def connect(self, sandbox_id: str) -> SandboxRef:
        """Reconnect without taking ownership or starting another worker."""
        from opensandbox.sync.sandbox import SandboxSync

        if sandbox_id not in self._boxes:
            self._boxes[sandbox_id] = SandboxSync.connect(
                sandbox_id, connection_config=self._config,
                connect_timeout=timedelta(seconds=120),
            )
        return SandboxRef(sandbox_id)

    def info(self, sandbox: SandboxRef) -> dict:
        return self._boxes[sandbox.id].get_info().model_dump(mode="json")

    def assert_no_worker_metadata(self, positions) -> None:
        """Reconcile a rejected create before any new keyless allocation."""
        from opensandbox.models.sandboxes import SandboxFilter

        page = 1
        while True:
            result = self._manager.list_sandbox_infos(SandboxFilter(
                metadata={'role': 'long-horizon-worker'}, page=page, page_size=100))
            if any((row.metadata or {}).get('position') in positions for row in result.sandbox_infos):
                raise RuntimeError('original or repaired worker already exists; reconcile its identity')
            if not result.pagination.has_next_page:
                return
            page += 1

    def renew_until(self, sandbox: SandboxRef, expires_at: datetime) -> None:
        remaining = expires_at - datetime.now(timezone.utc)
        if remaining.total_seconds() <= 0:
            raise ValueError("cannot renew to an expired deadline")
        self._boxes[sandbox.id].renew(remaining)

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
        info = box.create_snapshot(name=name)
        return SnapshotRef(info.id, info.status.state, info.status.message)

    def get_snapshot(self, snapshot_id: str) -> SnapshotRef:
        info = self._manager.get_snapshot(snapshot_id)
        return SnapshotRef(info.id, info.status.state, info.status.message)

    def detach(self, sandbox: SandboxRef) -> None:
        """Forget a sandbox without destroying it. The caller keeps it running."""
        box = self._boxes.pop(sandbox.id, None)
        self._owned.discard(sandbox.id)
        if box is not None:
            box.close()

    def destroy(self, sandbox: SandboxRef) -> None:
        box = self._boxes.get(sandbox.id)
        if box is None:
            return
        box.destroy()
        self.detach(sandbox)

    def close(self) -> None:
        failures = []
        for sandbox in list(self._boxes):
            try:
                if sandbox in self._owned:
                    self.destroy(SandboxRef(sandbox))
                else:
                    self.detach(SandboxRef(sandbox))
            except Exception as error:
                failures.append(error)
        self._manager.close()
        if failures:
            raise RuntimeError(f"failed to clean up {len(failures)} sandbox handles") from failures[0]
