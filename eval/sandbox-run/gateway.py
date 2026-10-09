"""Private named-volume channel from OpenSandbox to the existing DSH gateway."""
import datetime
import json
from pathlib import Path
import subprocess
import tarfile
import time
import uuid

from records import exclusive_json

LABEL = 'dsh.long-horizon.lease'
SOCKET = '/check-channel/check.sock'


def docker(context, *args):
    result = subprocess.run(['docker', '--context', context, *args], check=True,
                            capture_output=True, text=True, timeout=60)
    return result.stdout.strip()


def prepare_gateway(*, context: str, admin_image: str, check_image: str, tarball: Path,
                    root: Path, deadline_at: str, platform='linux/arm64') -> dict:
    """Reserve ownership before allocating resources. This starts no model."""
    lease = uuid.uuid4().hex
    planned = {role: 'dsh-lh-' + lease + '-' + role for role in ('client', 'private', 'channel')}
    receipt = {'lease': lease, 'context': context, 'adminImage': admin_image, 'checkImage': check_image,
               'deadlineAt': deadline_at, 'platform': platform, 'adminName': 'dsh-lh-admin-' + lease,
               'plannedVolumes': planned, 'modelRequests': 0}
    exclusive_json(root / 'gateway-intent.json', receipt)
    volumes = {}
    for role, name in planned.items():
        docker(context, 'volume', 'create', '--label', LABEL + '=' + lease, name)
        observed = json.loads(docker(context, 'volume', 'inspect', name))[0]
        if observed['Name'] != name or observed.get('Labels', {}).get(LABEL) != lease:
            raise RuntimeError('gateway storage ownership differs')
        volumes[role] = {'name': name, 'path': observed['Mountpoint']}
    receipt['volumes'] = volumes
    receipt['workerVolumes'] = [
        {'name': 'review-client', 'pvc': {'claim_name': planned['client']},
         'mount_path': volumes['client']['path'], 'read_only': False},
        {'name': 'check-channel', 'pvc': {'claim_name': planned['channel']},
         'mount_path': '/check-channel', 'read_only': True},
    ]
    receipt['verification'] = {'storageRoot': volumes['client']['path'], 'checkGatewaySocket': SOCKET,
        'container': {'context': 'default', 'image': check_image, 'cpus': 2, 'memoryMiB': 8192, 'pids': 256},
        'maxFiles': 100000, 'maxBytes': 512 * 1024 * 1024, 'runtimeLinkTargets': [],
        'commandDeadlineMs': 120000, 'commandOutputBytes': 1024 * 1024, 'deadlineMs': 600000}
    bundle = root / 'bundle'
    bundle.mkdir()
    with tarfile.open(tarball) as archive:
        archive.extractall(bundle, filter='data')
    profile = root / 'admin-home/profiles/check-gateway'
    profile.mkdir(parents=True)
    (profile / 'package.json').write_text(json.dumps({'private': True, 'type': 'module', 'dsh': {'profile': {'bundles': []}}}))
    (profile / 'cordis.yml').write_text('[]\n')
    config = {key: value for key, value in receipt['verification'].items()
              if key not in ('deadlineMs', 'checkGatewaySocket')}
    config.update(socketPath=SOCKET, privateStorageRoot=volumes['private']['path'], deadlineAt=deadline_at)
    (profile / 'cordis.patch.yml').write_text(json.dumps([{'insert': [
        {'id': 'subprocess', 'name': '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js'},
        {'id': 'check-gateway', 'name': '/plugin/lib/check-gateway.mjs', 'config': config},
    ]}]))
    args = ['create', '--name', receipt['adminName'], '--label', LABEL + '=' + lease, '--pull', 'never',
            '--platform', platform, '--network', 'none', '--cpus', '1', '--memory', '1024m',
            '--env', 'DSH_HOME=/admin-home', '--env', 'DSH_TELEMETRY_DISABLED=1',
            '--mount', 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock']
    for role in ('client', 'private', 'channel'):
        destination = '/check-channel' if role == 'channel' else volumes[role]['path']
        args.extend(['--mount', f'type=volume,source={planned[role]},target={destination}'])
    args.extend(['--entrypoint', '/bin/sh', admin_image, '-c',
                 'ln -s /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules /plugin/node_modules; '
                 'exec dsh --profile check-gateway'])
    container_id = docker(context, *args)
    receipt['adminId'] = container_id
    exclusive_json(root / 'gateway-created.json', receipt)
    docker(context, 'cp', str(bundle / 'package'), container_id + ':/plugin')
    docker(context, 'cp', str(root / 'admin-home'), container_id + ':/admin-home')
    docker(context, 'start', container_id)
    for attempt in range(60):
        if subprocess.run(['docker', '--context', context, 'exec', container_id, 'test', '-S', SOCKET],
                          capture_output=True, timeout=10).returncode == 0:
            exclusive_json(root / 'gateway-ready.json', {'adminId': container_id, 'lease': lease})
            return receipt
        if attempt == 59:
            logs = root / 'gateway-private.log'
            logs.write_text(docker(context, 'logs', container_id)); logs.chmod(0o600)
            raise RuntimeError('administrator gateway unavailable; model admission forbidden')
        time.sleep(1)


def stop_gateway(receipt: dict, *, root: Path, retain_storage=True) -> None:
    """Only remove this lease's admin, after native resource cleanup."""
    context, lease = receipt['context'], receipt['lease']
    row = json.loads(docker(context, 'inspect', receipt['adminId']))[0]
    if row['Id'] != receipt['adminId'] or row['Config'].get('Labels', {}).get(LABEL) != lease:
        raise RuntimeError('foreign administrator; refusing cleanup')
    docker(context, 'stop', '--time', '30', receipt['adminId'])
    (root / 'gateway-private.log').write_text(docker(context, 'logs', receipt['adminId']))
    docker(context, 'rm', receipt['adminId'])
    if not retain_storage:
        for item in receipt['volumes'].values():
            row = json.loads(docker(context, 'volume', 'inspect', item['name']))[0]
            if row.get('Labels', {}).get(LABEL) != lease:
                raise RuntimeError('foreign storage; refusing cleanup')
            docker(context, 'volume', 'rm', item['name'])
    exclusive_json(root / 'gateway-cleanup.json', {'adminRemoved': True, 'storageRetained': retain_storage,
                                                 'lease': lease})
