"""Keyless public baseline plus actual candidate snapshot/check admission."""
from datetime import datetime, timezone
import json
from pathlib import Path
import time

from execution import checked
from gateway import archive_storage, prepare_gateway, stop_gateway
from probe import wait_snapshot
from records import exclusive_json


def admit(runtime, *, candidate, image, tarball, probe, admin_image, context, out):
    exclusive_json(out / 'intent.json', {'taskId': candidate['id'], 'image': image,
        'baseCommit': candidate['baseCommit'], 'modelRequests': 0})
    gateway = prepare_gateway(context=context, admin_image=admin_image, check_image=image,
        tarball=tarball, root=out / 'gateway', deadline_at=datetime.fromtimestamp(
            time.time() + 1200, timezone.utc).isoformat())
    box = runtime.create(image=image, snapshot_id=None, metadata={'role': 'public-keyless-admission', 'task': candidate['id']},
        timeout_minutes=20, cpu='2', memory='8Gi', platform='linux/amd64', network_policy='deny', volumes=gateway['workerVolumes'])
    exclusive_json(out / 'created.json', {'sandboxId': box.id})
    try:
        checked(runtime, box, 'mkdir -p /workspace && cp -a /app/. /workspace/', 120)
        head = checked(runtime, box, 'git -C /workspace rev-parse HEAD').strip()
        if head != candidate['baseCommit'] or checked(runtime, box, 'git -C /workspace status --porcelain').strip():
            raise ValueError('candidate baseline is not clean')
        runtime.write(box, '/opt/eval/gateway-probe.mjs', probe.read_bytes())
        checked(runtime, box, 'ln -s /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules /opt/eval/node_modules')
        argv = ['go', 'test', './...', '-run', '^$'] if candidate['language'] == 'go' else ['node', '-e',
            "const fs=require('node:fs'); if(fs.readFileSync('.dsh-untracked-probe','utf8')!=='untracked artifact\\n')throw Error('snapshot input');console.log(require('./package.json').name,process.arch)"]
        config = {'workspace': '/workspace', 'storageRoot': gateway['verification']['storageRoot'],
            'gatewaySocket': gateway['verification']['checkGatewaySocket'], 'image': image,
            'output': '/opt/eval/topology-result.json', 'deadlineMs': 180000, 'argv': argv,
            'runtimeLinkTargets': [], 'maxFiles': 100000, 'maxBytes': 512 * 1024 * 1024}
        root = '/opt/eval/keyless-home/profiles/probe'
        runtime.write(box, root + '/package.json', json.dumps({'private': True, 'type': 'module', 'dsh': {'profile': {'bundles': []}}}).encode())
        runtime.write(box, root + '/cordis.yml', b'[]\n')
        runtime.write(box, root + '/cordis.patch.yml', json.dumps([{'insert': [
            {'id': 'subprocess', 'name': '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js'},
            {'id': 'probe', 'name': '/opt/eval/gateway-probe.mjs', 'config': config}]}]).encode())
        runtime.exec(box, 'DSH_HOME=/opt/eval/keyless-home DSH_TELEMETRY_DISABLED=1 dsh --profile probe > /opt/eval/keyless.log 2>&1 & p=$!; echo "$p" > /opt/eval/keyless.pid; wait "$p"', timeout_s=None, background=True)
        for _ in range(200):
            code, _, _ = runtime.exec(box, 'test -f /opt/eval/topology-result.json', timeout_s=5)
            if code == 0: break
            time.sleep(1)
        else: raise TimeoutError('candidate private check did not finish')
        result = json.loads(runtime.read(box, '/opt/eval/topology-result.json'))
        if result.get('error') or result.get('dockerSocketMounted') or result.get('check', {}).get('exitCode') != 0 \
                or not result.get('snapshot', {}).get('untrackedCaptured') or not result.get('recoveryAcknowledged'):
            private = out / 'private-topology-result.json'; private.write_text(json.dumps(result)); private.chmod(0o600)
            raise RuntimeError('candidate independent snapshot/check admission failed')
        checked(runtime, box, 'rm /workspace/.dsh-untracked-probe')
        if checked(runtime, box, 'git -C /workspace status --porcelain').strip(): raise ValueError('check changed source baseline')
        # Snapshot has no credentials, grading material or running Host. Only
        # image runtimes and the clean repository are reused by future positions.
        checked(runtime, box, 'kill -TERM "$(cat /opt/eval/keyless.pid)"')
        for _ in range(60):
            code, _, _ = runtime.exec(box, 'kill -0 "$(cat /opt/eval/keyless.pid)" 2>/dev/null', timeout_s=5)
            if code != 0: break
            time.sleep(.5)
        else: raise RuntimeError('keyless Host did not stop before baseline')
        checked(runtime, box, 'rm -rf /opt/eval/keyless-home /opt/eval/gateway-probe.mjs /opt/eval/topology-result.json /opt/eval/keyless.log /opt/eval/keyless.pid /opt/eval/node_modules')
        # Build the reusable baseline in a separate box without this lease's
        # mounts. Docker image snapshots retain volume declarations, so a
        # check-admission worker must not become a later position's baseline.
        runtime.destroy(box)
        stop_gateway(gateway, root=out / 'gateway')
        archive_storage(gateway, root=out / 'gateway')
        exclusive_json(out / 'check-cleanup.json', {'sandboxId': box.id,
            'destroyed': True, 'gatewayStopped': True})
        box = runtime.create(image=image, snapshot_id=None,
            metadata={'role': 'public-keyless-baseline', 'task': candidate['id']},
            timeout_minutes=10, cpu='2', memory='2Gi', platform='linux/amd64',
            network_policy='deny')
        exclusive_json(out / 'baseline-created.json', {'sandboxId': box.id})
        checked(runtime, box, 'mkdir -p /workspace && cp -a /app/. /workspace/', 120)
        if checked(runtime, box, 'git -C /workspace rev-parse HEAD').strip() != head \
                or checked(runtime, box, 'git -C /workspace status --porcelain').strip():
            raise ValueError('reusable keyless baseline differs')
        snapshot = runtime.create_snapshot(box, candidate['id'] + '-keyless-baseline')
        wait_snapshot(runtime, snapshot.id, timeout_s=180, sleep=time.sleep, monotonic=time.monotonic)
        receipt = {'taskId': candidate['id'], 'image': image, 'snapshotId': snapshot.id,
            'baseCommit': head, 'modelRequests': 0, 'passed': True,
            'snapshot': result['snapshot'], 'checkExitCode': result['check']['exitCode'],
            'checkImage': image, 'sourceUnchanged': True, 'dockerSocketMounted': False,
            'baselineHasGatewayMounts': False, 'baselineHasCredentials': False}
        exclusive_json(out / 'baseline.json', receipt)
        return receipt
    finally:
        runtime.destroy(box)
        if not (out / 'check-cleanup.json').exists():
            stop_gateway(gateway, root=out / 'gateway')
            archive_storage(gateway, root=out / 'gateway')
        exclusive_json(out / 'cleanup.json', {'sandboxId': box.id, 'destroyed': True, 'gatewayStopped': True})
