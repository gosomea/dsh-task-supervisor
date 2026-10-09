"""Deterministic monitor transport for DSH's authenticated public API."""
import json
from pathlib import Path
import shlex
import uuid

from dsh_rpc import DshRpc, DshRpcError


class RuntimeDshRpc(DshRpc):
    def __init__(self, runtime, box, *, timeout=30):
        super().__init__('http://127.0.0.1:3080', dialect='slash', timeout=timeout)
        self.runtime, self.box = runtime, box
        for name in ('dsh_rpc.py', 'local_rpc.py'):
            runtime.write(box, '/opt/eval/' + name, Path(__file__).with_name(name).read_bytes(), mode=600)

    def call(self, method: str, args: dict, *, timeout=None):
        return self._invoke({'method': method, 'args': args}, timeout=timeout)

    def http(self, verb: str, path: str, body=None, *, timeout=None):
        if verb not in ('GET', 'POST') or not path.startswith('/api/') or '?' in path.split('/api/', 1)[0]:
            raise ValueError('only public API paths are allowed')
        return self._invoke({'verb': verb, 'httpPath': path, 'body': body}, timeout=timeout)

    def _invoke(self, payload: dict, *, timeout=None):
        limit = timeout or self.timeout
        identity = uuid.uuid4().hex
        request, response = [f'/opt/eval/rpc-{identity}-{suffix}.json' for suffix in ('request', 'response')]
        self.runtime.write(self.box, request, json.dumps({**payload, 'timeout': limit}).encode(), mode=600)
        try:
            code, _, error = self.runtime.exec(self.box,
                'python3 /opt/eval/local_rpc.py ' + shlex.quote(request) + ' ' + shlex.quote(response),
                timeout_s=int(limit) + 15)
            if code != 0:
                raise DshRpcError('sandbox-local public API failed: ' + error[-500:])
            return json.loads(self.runtime.read(self.box, response))
        finally:
            self.runtime.exec(self.box, 'rm -f -- ' + shlex.quote(request) + ' ' + shlex.quote(response), timeout_s=10)
