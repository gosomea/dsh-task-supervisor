"""Keyless admission in the actual frozen DSH/OpenSandbox runtime."""
import hashlib
import json
import time
from pathlib import Path

from runtime_rpc import RuntimeDshRpc
from records import exclusive_json


def file_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def native_preflight(runtime, *, image: str, tarball: Path, tarball_sha256: str,
                     probe: Path, out: Path) -> dict:
    if file_digest(tarball) != tarball_sha256:
        raise ValueError('frozen tarball digest differs')
    exclusive_json(out / 'native-intent.json', {'image': image, 'tarballSha256': tarball_sha256,
                                             'probeSha256': file_digest(probe), 'modelRequests': 0})
    box = runtime.create(image=image, snapshot_id=None, metadata={'role': 'native-preflight'},
                         timeout_minutes=15, cpu='2', memory='8Gi', network_policy='allow')
    exclusive_json(out / 'native-started.json', {'sandboxId': box.id})
    result = None
    try:
        runtime.write(box, '/opt/eval/plugin.tgz', tarball.read_bytes())
        runtime.write(box, '/opt/eval/native-probe.mjs', probe.read_bytes())
        runtime.write(box, '/opt/eval/relay.py', Path(__file__).with_name('loopback_relay.py').read_bytes())
        runtime.write(box, '/workspace/README.md', b'keyless native permission probe\n')
        runtime.write(box, '/opt/eval/outside-sentinel', b'administrator sentinel\n')
        patch = [
            {'id': 'permission', 'config': {'defaultPreset': 'workspace-write'}},
            {'insert': [{'id': 'native-probe', 'name': '/opt/eval/native-probe.mjs',
                         'config': {'output': '/opt/eval/native-result.json',
                                    'outsidePath': '/opt/eval/outside-sentinel'}}]},
        ]
        runtime.write(box, '/opt/eval/native.patch.yml', json.dumps(patch).encode())
        command = '\n'.join([
            'set -eu',
            'export DSH_HOME=/opt/eval/home DSH_TELEMETRY_DISABLED=1',
            'ln -s /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules /opt/eval/node_modules',
            'dsh plugin --profile web add --config.strict-peer-dependencies=false /opt/eval/plugin.tgz',
            'cp /opt/eval/native.patch.yml /opt/eval/home/profiles/web/cordis.patch.yml',
        ])
        code, installation, error = runtime.exec(box, command, timeout_s=300)
        (out / 'native-install.log').write_text(installation + '\n' + error)
        if code != 0:
            raise RuntimeError('native fixture installation failed: ' + error[-1500:])
        code, _, error = runtime.exec(box,
            'DSH_HOME=/opt/eval/home DSH_TELEMETRY_DISABLED=1 dsh web --host 127.0.0.1 --port 3080 --no-open '
            '--trusted-host host.docker.internal --trusted-host localhost '
            '> /opt/eval/host.log 2>&1', background=True)
        runtime.exec(box, 'python3 /opt/eval/relay.py > /opt/eval/relay.log 2>&1', background=True)
        rpc = RuntimeDshRpc(runtime, box, timeout=10)
        for attempt in range(60):
            try:
                rpc.list_sessions()
                break
            except Exception:
                if attempt == 59:
                    raise RuntimeError('keyless DSH host unavailable; private host log retained')
                time.sleep(1)
        workspace = rpc.create_workspace('/workspace')
        session = rpc.create_session(workspace['workspace']['workspaceId'])
        session_id = session['sessionId']
        rpc.command(session_id, '/eval-native', timeout=70)
        result = json.loads(runtime.read(box, '/opt/eval/native-result.json'))
        passed = result.get('policy', {}).get('mode') == 'workspace-write' \
            and result.get('cwd') == '/workspace' and result.get('write', {}).get('exitCode') == 0 \
            and result.get('read', {}).get('exitCode') == 0 \
            and result.get('nativeRead', {}).get('isError') is False \
            and result.get('written') == 'native workspace write\n' \
            and result.get('denied', {}).get('exitCode') != 0 \
            and result.get('outsideUnchanged') is True and not result.get('error')
        result.update(passed=bool(passed), image=image, tarballSha256=tarball_sha256)
        exclusive_json(out / 'native-result.json', result)
        if not passed:
            raise RuntimeError('native execution admission failed; model delivery forbidden')
        return result
    except Exception as error:
        # Retain diagnostics before disposal even if installation fails.
        code, logs, stderr = runtime.exec(box,
            'find /opt/eval/home -name pnpm.log -type f -exec cat {} \\; ; '
            'test ! -f /opt/eval/host.log || cat /opt/eval/host.log', timeout_s=10)
        private = out / 'native-private-diagnostics.log'
        private.write_text(logs + '\n' + stderr)
        private.chmod(0o600)
        exclusive_json(out / 'native-fault.json', {'errorType': type(error).__name__,
                                                'modelAdmitted': False, 'sandboxId': box.id})
        raise
    finally:
        # This probe owns this exact sandbox; it never cleans foreign resources.
        runtime.destroy(box)
        exclusive_json(out / 'native-cleanup.json', {'sandboxId': box.id, 'destroyed': True})
