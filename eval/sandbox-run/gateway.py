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
    administrator = docker(context, 'ps', '-aq', '--no-trunc', '--filter', 'id=' + receipt['adminId'])
    previous = root / 'gateway-cleanup.json'
    if previous.exists():
        value = json.loads(previous.read_text())
        if value.get('lease') != lease or value.get('adminRemoved') is not True:
            raise RuntimeError('sealed gateway cleanup identity differs')
        ledger = json.loads((root / 'check-quiescence.json').read_text())
        if ledger.get('lease') != lease or not ledger.get('acknowledged'):
            raise RuntimeError('original gateway cleanup retained an infrastructure fault')
        if administrator:
            row = json.loads(docker(context, 'inspect', receipt['adminId']))[0]
            if row['Id'] != receipt['adminId'] or row['Config'].get('Labels', {}).get(LABEL) != lease or row['State']['Running']:
                raise RuntimeError('sealed cleanup has a live or foreign administrator')
            docker(context, 'rm', receipt['adminId'])
            repaired = root / 'administrator-removal-reconciled.json'
            if not repaired.exists():
                exclusive_json(repaired, {'lease': lease, 'adminId': receipt['adminId'],
                    'originalCleanupPreserved': True, 'removedAfterNativeQuiescence': True})
        return
    if administrator:
        row = json.loads(docker(context, 'inspect', receipt['adminId']))[0]
        if row['Id'] != receipt['adminId'] or row['Config'].get('Labels', {}).get(LABEL) != lease:
            raise RuntimeError('foreign administrator; refusing cleanup')
        docker(context, 'stop', '--time', '30', receipt['adminId'])
        if docker(context, 'inspect', '--format', '{{.State.Running}}', receipt['adminId']) != 'false':
            raise RuntimeError('administrator did not stop')
        log = root / 'gateway-private.log'
        log.write_text(docker(context, 'logs', receipt['adminId'])); log.chmod(0o600)
    elif not (root / 'check-quiescence.json').exists():
        raise RuntimeError('administrator missing without its original cleanup evidence')
    # Read the private native cleanup ledger after disposal, using a keyless
    # bounded helper. A fallback removal is a fault, not a native cleanup ack.
    private = receipt['volumes']['private']
    inspected = json.loads(docker(context, 'volume', 'inspect', private['name']))[0]
    if inspected.get('Labels', {}).get(LABEL) != lease or inspected['Mountpoint'] != private['path']:
        raise RuntimeError('private storage ownership differs')
    script = r'''const fs=require('fs'),path=require('path'),root=process.argv[1],out=[];
for(const file of fs.readdirSync(root)){if(!/^snapshot-[a-f0-9-]{36}\.json$/.test(file))continue;
const s=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
if(path.dirname(s.root)!==root||fs.realpathSync(s.root)!==s.root)throw Error('snapshot binding');
for(const f of fs.readdirSync(s.root)){if(!/^container-[a-f0-9-]{36}\.json$/.test(f))continue;
const id=f.slice(10,-5),r=JSON.parse(fs.readFileSync(path.join(s.root,f),'utf8'));
const removed=path.join(s.root,'removed-'+id+'.json');out.push({snapshotId:s.id,id,record:r,
removed:fs.existsSync(removed)?JSON.parse(fs.readFileSync(removed,'utf8')):null});}}
console.log(JSON.stringify(out));'''
    rows = json.loads(docker(context, 'run', '--rm', '--pull', 'never', '--network', 'none',
        '--label', LABEL + '=' + lease, '--read-only', '--cpus', '.25', '--memory', '256m',
        '--mount', f'type=volume,source={private["name"]},target={private["path"]},readonly',
        '--entrypoint', 'node', receipt['adminImage'], '-e', script, private['path']))
    faults = []
    for check in rows:
        record = check['record']; removed = check['removed']
        if record['image'] != receipt['checkImage'] or record['snapshotId'] != check['snapshotId'] or record['name'] != 'dsh-review-' + check['id']:
            raise RuntimeError('check ledger identity differs')
        remaining = docker(context, 'ps', '-aq', '--no-trunc', '--filter', 'name=^/' + record['name'] + '$')
        if remaining:
            item = json.loads(docker(context, 'inspect', remaining))[0]
            if item.get('Config', {}).get('Labels', {}).get('dsh.supervisor.snapshot') != check['snapshotId']:
                raise RuntimeError('foreign check; refusing fallback cleanup')
            docker(context, 'rm', '-f', remaining)
            faults.append('fallback-removal:' + check['id'])
        if not removed or removed.get('removed') is not True or removed.get('name') != record['name']:
            faults.append('native-removal-unacknowledged:' + check['id'])
    settled = {'lease': lease, 'acknowledged': not faults,
        'checks': [{'snapshotId': row['snapshotId'], 'id': row['id']} for row in rows], 'faults': faults}
    ledger = root / 'check-quiescence.json'
    if ledger.exists():
        if json.loads(ledger.read_text()) != settled: raise RuntimeError('settled check cleanup evidence differs')
    else: exclusive_json(ledger, settled)
    if administrator: docker(context, 'rm', receipt['adminId'])
    if not retain_storage:
        for item in receipt['volumes'].values():
            row = json.loads(docker(context, 'volume', 'inspect', item['name']))[0]
            if row.get('Labels', {}).get(LABEL) != lease:
                raise RuntimeError('foreign storage; refusing cleanup')
            docker(context, 'volume', 'rm', item['name'])
    exclusive_json(root / 'gateway-cleanup.json', {'adminRemoved': True, 'storageRetained': retain_storage,
                                                 'lease': lease})
    if faults:
        raise RuntimeError('checks required fallback cleanup; retain infrastructure fault')


def archive_storage(receipt, *, root):
    """Preserve actual snapshots/output before releasing this settled lease.

    The archive is private diagnostic evidence, never model input or a public
    report. Unknown interrupted exports remain reserved for reconciliation.
    """
    import gzip
    import hashlib
    import os
    context, lease = receipt['context'], receipt['lease']
    cleanup = json.loads((root / 'gateway-cleanup.json').read_text())
    if cleanup.get('lease') != lease or not cleanup.get('adminRemoved'):
        raise RuntimeError('gateway must stop before storage collection')
    archive = root / 'check-storage.tar.gz'
    seal = root / 'check-storage.json'
    intent = root / 'check-storage-intent.json'
    if not seal.exists():
        reserved = intent.exists()
        helper = 'dsh-lh-archive-' + lease
        if reserved:
            original = json.loads(intent.read_text())
            if original != {'lease': lease, 'volumes': receipt['volumes'], 'helper': helper}:
                raise ValueError('original storage export identity differs')
            # A lost response never starts a second export. Wait for the owned
            # original helper, then validate its complete bytes or retain fault.
            for _ in range(60):
                live = docker(context, 'ps', '-q', '--filter', 'name=^/' + helper + '$', '--filter', 'label=' + LABEL + '=' + lease)
                if not live: break
                time.sleep(1)
            else: raise RuntimeError('original storage export still running')
        else:
            exclusive_json(intent, {'lease': lease, 'volumes': receipt['volumes'], 'helper': helper})
        args = ['docker', '--context', context, 'run', '--rm', '--name', 'dsh-lh-archive-' + lease,
            '--pull', 'never', '--network', 'none', '--read-only', '--cpus', '.25', '--memory', '256m',
            '--label', LABEL + '=' + lease]
        for role, item in receipt['volumes'].items():
            row = json.loads(docker(context, 'volume', 'inspect', item['name']))[0]
            if row.get('Labels', {}).get(LABEL) != lease or row['Mountpoint'] != item['path']:
                raise RuntimeError('foreign storage; refusing export')
            if docker(context, 'ps', '-aq', '--filter', 'volume=' + item['name']):
                raise RuntimeError('storage still mounted by original execution')
            args.extend(['--mount', f'type=volume,source={item["name"]},target=/archive/{role},readonly'])
        args.extend(['--entrypoint', 'tar', receipt['adminImage'], '-czf', '-', '-C', '/archive', 'client', 'private', 'channel'])
        partial = root / 'check-storage.part.gz'
        # The output is exclusively created before launching tar. A reservation
        # with no output and no original helper therefore never launched export.
        # Reconcile that pre-launch failure without replaying an unknown export.
        if not reserved or (not partial.exists() and not archive.exists()):
            with partial.open('xb') as output:
                subprocess.run(args, stdout=output, stderr=subprocess.PIPE, check=True, timeout=600)
                output.flush(); os.fsync(output.fileno())
            partial.chmod(0o600)
        source_path = archive if archive.exists() else partial
        # Reading through EOF checks the gzip trailer, including after a crash
        # between rename and seal. An incomplete export is never accepted.
        with gzip.open(source_path, 'rb') as source:
            while source.read(1024 * 1024): pass
        with tarfile.open(source_path, 'r:gz') as source:
            names = source.getnames()
            if {name.split('/')[0] for name in names} != {'client', 'private', 'channel'} \
                    or not all('..' not in name.split('/') for name in names):
                raise ValueError('storage archive paths differ')
        if source_path != archive: os.rename(partial, archive)
        with archive.open('rb') as stream: digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        exclusive_json(seal, {'lease': lease, 'sha256': digest,
            'bytes': archive.stat().st_size, 'members': len(names), 'source': 'actual-settled-check-storage'})
    frozen = json.loads(seal.read_text())
    with archive.open('rb') as stream: digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if frozen['lease'] != lease or digest != frozen['sha256']: raise ValueError('sealed storage archive changed')
    removed = root / 'check-storage-released.json'
    if removed.exists(): return
    existing = set(docker(context, 'volume', 'ls', '--format', '{{.Name}}').splitlines())
    for item in receipt['volumes'].values():
        if item['name'] not in existing: continue  # Prior removal after a durable archive.
        row = json.loads(docker(context, 'volume', 'inspect', item['name']))[0]
        if row.get('Labels', {}).get(LABEL) != lease: raise RuntimeError('foreign storage; refusing removal')
        docker(context, 'volume', 'rm', item['name'])
    exclusive_json(removed, {'lease': lease, 'archivedBeforeRemoval': True, 'sha256': frozen['sha256']})
