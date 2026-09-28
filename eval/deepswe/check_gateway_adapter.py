"""Bind the plugin's administrator gateway to one benchmark task's deadline.

The task gets only client storage and a Unix channel. Private ledgers remain on
an administrator-only Linux volume. A missing native removal record is a fault,
even when fallback cleanup has made the daemon container disappear.
"""
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time
import uuid

from control_flow import exclusive_json

LABEL = 'dsh.deepswe.attempt'
VOLUME_LABEL = 'dsh.deepswe.check-storage'
SOCKET = '/check-channel/check.sock'


def prepare(spec, lease, docker):
    """Allocate distinct labelled volumes and return the native task overlay."""
    if spec['condition'] != 'supervisor-independent':
        return None, '', []
    settings = dict(spec['independentChecks'])
    permitted = {'maxFiles', 'maxBytes', 'runtimeLinkTargets', 'commandDeadlineMs',
                 'commandOutputBytes', 'deadlineMs', 'pids'}
    if set(settings) != permitted or any(type(settings[key]) is not int or settings[key] < 1
            for key in permitted - {'runtimeLinkTargets'}):
        raise ValueError('Independent check settings must be explicit frozen deployment inputs')
    if settings['commandDeadlineMs'] > 3600000 or settings['deadlineMs'] > 3600000:
        raise ValueError('Independent review bounds exceed the plugin contract')
    if not 8 <= settings['pids'] <= 1024 or settings['commandOutputBytes'] > 16 * 1024 * 1024:
        raise ValueError('Independent check resource bounds exceed the plugin contract')
    if not isinstance(settings['runtimeLinkTargets'], list) or any(not isinstance(p, str) or not p.startswith('/')
            or '\0' in p for p in settings['runtimeLinkTargets']):
        raise ValueError('Invalid independent check runtime links')
    supervisor = spec.get('supervisorConfig')
    full_config = {'reviewerModel', 'reviewRepairAttempts', 'reviewDeadlineMs', 'progressReviewMode',
                  'observationToolCalls', 'observationIntervalMs', 'observationConsecutiveErrors',
                  'maxAutomaticRoundsWithoutReport'}
    if not isinstance(supervisor, dict) or 'independentVerification' in supervisor or not full_config.issubset(supervisor):
        raise ValueError('The full frozen Supervisor configuration must be restated')
    context = spec['dockerContext']
    root = Path(spec['home']).resolve().with_name(Path(spec['home']).name + '-checks')
    root.mkdir(mode=0o700)
    channel = root / 'channel'; channel.mkdir(mode=0o700)
    home = root / 'admin-home'; (home / 'profiles/check-gateway').mkdir(parents=True, mode=0o700)
    volumes = {}
    receipt = {'schemaVersion': 1, 'lease': lease, 'dockerContext': context,
        'root': str(root), 'channel': str(channel), 'adminHome': str(home),
        'adminContainer': 'dsh-check-admin-' + lease[:12], 'runtime': str(Path(spec['runtime']).resolve()),
        'imageDigest': spec['imageDigest'], 'settings': settings,
        'adminResources': {'cpus': 1, 'memoryMiB': 1024},
        'checkResources': {'cpus': 2, 'memoryMiB': 8192, 'pids': settings['pids']},
        'plannedVolumes': {role: 'dsh-check-' + role + '-' + lease for role in ('client', 'private')}}
    exclusive_json(root / 'prepare-intent.json', receipt)
    try:
        for role in ('client', 'private'):
            name = receipt['plannedVolumes'][role]
            docker(context, 'volume', 'create', '--label', VOLUME_LABEL + '=' + lease, name)
            row = json.loads(docker(context, 'volume', 'inspect', name))[0]
            if row['Name'] != name or row.get('Labels', {}).get(VOLUME_LABEL) != lease:
                raise RuntimeError('Independent storage ownership differs')
            path = row['Mountpoint']
            if not re.fullmatch(r'/var/lib/docker/volumes/[^/]+/_data', path):
                raise RuntimeError('Independent storage is not daemon-local')
            volumes[role] = {'name': name, 'path': path}
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        exclusive_json(root / 'prepare-fault.json', {'errorType': type(error).__name__,
            'observedVolumes': volumes, 'retryAllowed': False,
            'reconciliation': 'inspect prepare-intent plannedVolumes and exact owner labels; retain evidence volumes'})
        raise
    receipt['volumes'] = volumes
    profile = home / 'profiles/check-gateway'
    (profile / 'node_modules').mkdir()
    (profile / 'node_modules/@deepseek-ai').symlink_to('/dsh/apps/cli/node_modules/@deepseek-ai')
    (profile / 'node_modules/dsh-task-supervisor').symlink_to('/plugin')
    (profile / 'package.json').write_text(json.dumps({'private': True, 'type': 'module',
        'dependencies': {'dsh-task-supervisor': 'link:/plugin',
        '@deepseek-ai/dsh-subprocess-local': 'link:/dsh/packages/subprocess/subprocess-local'},
        'dsh': {'profile': {'bundles': []}}}))
    (profile / 'cordis.yml').write_text('[]\n')
    config = {key: value for key, value in settings.items() if key != 'pids'}
    config.update(storageRoot=volumes['client']['path'], checkGatewaySocket=SOCKET,
        container={'context': 'default', 'image': spec['imageDigest'], **receipt['checkResources']})
    # JSON is valid YAML and does not execute deferred code. The overlay uses
    # the plugin's public independentVerification configuration.
    overlay = '\n' + json.dumps([{'id': 'task-supervisor', 'config': {**supervisor, 'independentVerification': config}}]) + '\n'
    # This JSON sequence must be parsed as a separate --patch file by the CLI.
    task_patch = root / 'task.patch.yml'; task_patch.write_text(overlay)
    receipt['taskPatch'] = str(task_patch)
    receipt['taskPatchSha256'] = hashlib.sha256(task_patch.read_bytes()).hexdigest()
    exclusive_json(root / 'prepare-receipt.json', receipt)
    mounts = [f'type=volume,source={volumes["client"]["name"]},target={volumes["client"]["path"]}',
              f'type=bind,source={channel},target=/check-channel,readonly',
              f'type=bind,source={task_patch},target=/check-task.patch.yml,readonly']
    return receipt, '/check-task.patch.yml', mounts


def arm(receipt, started, docker, *, clock=time.time, sleep=time.sleep):
    """Start an uncredentialed administrator before the first model delivery."""
    root = Path(receipt['root'])
    if (root / 'arm-intent.json').exists():
        raise RuntimeError('Uncertain gateway arm requires original-resource reconciliation')
    deadline = started['deadlineAtUnix']
    if deadline <= clock():
        raise TimeoutError('Task deadline passed before gateway arm')
    config = {key: value for key, value in receipt['settings'].items() if key not in ('pids', 'deadlineMs')}
    config.update(socketPath=SOCKET, storageRoot=receipt['volumes']['client']['path'],
        privateStorageRoot=receipt['volumes']['private']['path'],
        deadlineAt=datetime.datetime.fromtimestamp(deadline, datetime.timezone.utc).isoformat(),
        container={'context': 'default', 'image': receipt['imageDigest'], **receipt['checkResources']})
    patch = Path(receipt['adminHome']) / 'profiles/check-gateway/cordis.patch.yml'
    patch.write_text(json.dumps([{'insert': [{'id': 'subprocess', 'name': '@deepseek-ai/dsh-subprocess-local'},
        {'id': 'check-gateway', 'name': 'dsh-task-supervisor/check-gateway', 'config': config}]}]))
    intent = {'schemaVersion': 1, 'lease': receipt['lease'], 'sessionId': started['sessionId'],
        'deadlineAtUnix': deadline, 'adminContainer': receipt['adminContainer'], 'imageDigest': receipt['imageDigest'],
        'adminPatchSha256': hashlib.sha256(patch.read_bytes()).hexdigest()}
    exclusive_json(root / 'arm-intent.json', intent)
    context, runtime = receipt['dockerContext'], Path(receipt['runtime'])
    args = ['run', '-di', '--platform', 'linux/amd64', '--name', receipt['adminContainer'],
        '--label', LABEL + '=' + receipt['lease'], '--network', 'none', '--cpus', '1', '--memory', '1024m',
        '--env', 'DSH_HOME=/admin-home', '--env', 'DSH_TELEMETRY_DISABLED=1',
        '--env', 'PATH=/usr/local/bin:/usr/bin:/bin', '--entrypoint', '/usr/local/bin/node']
    for source, target, readonly in ((runtime / 'node24-linux-amd64', '/usr/local/bin/node', True),
        (runtime / 'docker-static-amd64', '/usr/local/bin/docker', True),
        (runtime / 'dsh-source', '/dsh', True), (runtime / 'plugin-source', '/plugin', True),
        (Path(receipt['adminHome']), '/admin-home', False), (Path(receipt['channel']), '/check-channel', False),
        (Path('/var/run/docker.sock'), '/var/run/docker.sock', False)):
        args += ['--mount', f'type=bind,source={source},target={target}' + (',readonly' if readonly else '')]
    for volume in receipt['volumes'].values():
        args += ['--mount', f'type=volume,source={volume["name"]},target={volume["path"]}']
    args += [receipt['imageDigest'], '/dsh/apps/cli/lib/bin.js', '--profile', 'check-gateway']
    container_id = docker(context, *args)
    exclusive_json(root / 'admin-created.json', {**intent, 'containerId': container_id})
    end = min(deadline, clock() + 30)
    while clock() < end:
        row = json.loads(docker(context, 'inspect', receipt['adminContainer']))[0]
        if row['Id'] != container_id or row.get('Config', {}).get('Labels', {}).get(LABEL) != receipt['lease']:
            raise RuntimeError('Administrator identity differs from the arm intent')
        if not row['State']['Running']:
            raise RuntimeError('Administrator exited before socket readiness')
        if (Path(receipt['channel']) / 'check.sock').is_socket():
            armed = {**intent, 'containerId': container_id, 'readyAtUnix': clock()}
            exclusive_json(root / 'arm-receipt.json', armed)
            return armed
        sleep(.1)
    raise TimeoutError('Gateway did not acknowledge readiness before task delivery')


LEDGER_READER = r'''const fs=require('fs'),path=require('path');const root=process.argv[1];
const rows=[];for(const f of fs.readdirSync(root)){if(!/^snapshot-[a-f0-9-]{36}\.json$/.test(f))continue;
const s=JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
if(path.dirname(s.root)!==root||fs.realpathSync(s.root)!==s.root)throw Error('private snapshot binding');
for(const l of fs.readdirSync(s.root)){if(!/^container-[a-f0-9-]{36}\.json$/.test(l))continue;
const id=l.slice(10,-5),record=JSON.parse(fs.readFileSync(path.join(s.root,l),'utf8'));
const removed=path.join(s.root,'removed-'+id+'.json');rows.push({id,snapshotId:s.id,record,
removed:fs.existsSync(removed)?JSON.parse(fs.readFileSync(removed,'utf8')):null});}}
console.log(JSON.stringify(rows));'''


def admin_identity(receipt):
    """An arm failure still retains the exact daemon ID returned at creation."""
    root = Path(receipt['root'])
    for name in ('arm-receipt.json', 'admin-created.json'):
        path = root / name
        if path.exists():
            row = json.loads(path.read_text())
            if row['lease'] != receipt['lease'] or row.get('adminContainer', receipt['adminContainer']) != receipt['adminContainer']:
                raise RuntimeError('Administrator creation record belongs to another lease')
            return row['containerId']
    return None


def ledger_rows(receipt, docker):
    """Read bounded control metadata without exporting private artifact trees."""
    context = receipt['dockerContext']
    volume = receipt['volumes']['private']
    ownership = json.loads(docker(context, 'volume', 'inspect', volume['name']))[0]
    if ownership['Name'] != volume['name'] or ownership.get('Labels', {}).get(VOLUME_LABEL) != receipt['lease'] or ownership['Mountpoint'] != volume['path']:
        raise RuntimeError('Private ledger volume ownership differs')
    admin = docker(context, 'container', 'ls', '-aq', '--no-trunc', '--filter', 'name=^/' + receipt['adminContainer'] + '$')
    if admin:
        observed = json.loads(docker(context, 'inspect', admin))[0]
        if observed['Id'] != admin_identity(receipt) or observed['Name'] != '/' + receipt['adminContainer'] or observed.get('Config', {}).get('Labels', {}).get(LABEL) != receipt['lease']:
            raise RuntimeError('Administrator ownership differs during ledger observation')
        if observed['State']['Running']:
            return json.loads(docker(context, 'exec', admin, '/usr/local/bin/node', '-e', LEDGER_READER, volume['path']))
    helper = 'dsh-check-ledger-' + str(uuid.uuid4())
    try:
        return json.loads(docker(context, 'run', '--rm', '--name', helper,
            '--label', LABEL + '=' + receipt['lease'], '--network', 'none', '--read-only',
            '--cpus', '.25', '--memory', '256m', '--pids-limit', '64',
            '--mount', f'type=volume,source={volume["name"]},target={volume["path"]},readonly',
            '--mount', f'type=bind,source={Path(receipt["runtime"]) / "node24-linux-amd64"},target=/node,readonly',
            '--entrypoint', '/node', receipt['imageDigest'], '-e', LEDGER_READER, volume['path']))
    finally:
        found = docker(context, 'container', 'ls', '-aq', '--no-trunc', '--filter', 'name=^/' + helper + '$')
        if found:
            row = json.loads(docker(context, 'inspect', found))[0]
            if row['Name'] != '/' + helper or row.get('Config', {}).get('Labels', {}).get(LABEL) != receipt['lease']:
                raise RuntimeError('Ledger helper ownership differs; refusing removal')
            docker(context, 'rm', '-f', found)


def settle_rows(receipt, rows, docker):
    """Remove exact ledger-bound resources without inventing native records."""
    fallback = []
    faults = []
    confirmed = True
    for row in rows:
        try:
            record = row['record']
            if record['name'] != 'dsh-review-' + row['id'] or record['snapshotId'] != row['snapshotId'] or record['image'] != receipt['imageDigest'] or record['endpoint'] != 'unix:///var/run/docker.sock':
                raise RuntimeError('Private check identity differs from its snapshot lease')
            found = docker(receipt['dockerContext'], 'container', 'ls', '-aq', '--no-trunc', '--filter', 'name=^/' + record['name'] + '$')
            if found:
                inspected = json.loads(docker(receipt['dockerContext'], 'inspect', found))[0]
                if inspected['Name'] != '/' + record['name'] or inspected.get('Config', {}).get('Labels', {}).get('dsh.supervisor.snapshot') != row['snapshotId']:
                    raise RuntimeError('Check ownership mismatch; refusing removal')
                docker(receipt['dockerContext'], 'rm', '-f', found)
                fallback.append(record['name']); confirmed = False
                if docker(receipt['dockerContext'], 'container', 'ls', '-aq', '--filter', 'id=' + found):
                    raise RuntimeError('Fallback check removal remains unconfirmed')
            if not row['removed'] or row['removed'].get('removed') is not True or row['removed'].get('name') != record['name']:
                confirmed = False
        except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
            confirmed = False
            faults.append({'id': row.get('id'), 'errorType': type(error).__name__})
    return confirmed, fallback, faults


def clean_checks(receipt, started, docker, *, clock=time.monotonic, sleep=time.sleep):
    """Require native removal records; fallback removal is cleanup, not an ack."""
    root = Path(receipt['root'])
    previous = root / 'quiescence.json'
    if previous.exists():
        result = json.loads(previous.read_text())
        if result['lease'] != receipt['lease'] or result['sessionId'] != started['sessionId'] or result['deadlineAtUnix'] != started['deadlineAtUnix']:
            raise RuntimeError('Original gateway quiescence belongs to another task')
        return result
    arm_record = root / 'arm-receipt.json'
    bound = json.loads(arm_record.read_text()) if arm_record.exists() else None
    result = {'schemaVersion': 1, 'lease': receipt['lease'], 'sessionId': started['sessionId'],
        'deadlineAtUnix': started['deadlineAtUnix'], 'acknowledged': False, 'nativeRemovalAcknowledged': False,
        'fallbackRemoved': [], 'observedChecks': [], 'checkFaults': [], 'extraCheckCpuNs': None}
    try:
        if not bound or bound['deadlineAtUnix'] != started['deadlineAtUnix'] or bound['sessionId'] != started['sessionId']:
            raise RuntimeError('Gateway deadline was not bound before delivery')
        end = clock() + 45
        while True:
            rows = ledger_rows(receipt, docker)
            if all(row['removed'] and row['removed'].get('removed') is True and row['removed'].get('name') == row['record']['name'] for row in rows) or clock() >= end:
                break
            sleep(.5)
        result['observedChecks'] = [{'id': row['id'], 'snapshotId': row['snapshotId'],
            'name': row['record']['name'], 'nativeRemoved': bool(row['removed'] and row['removed'].get('removed') is True)} for row in rows]
        confirmed, fallback, faults = settle_rows(receipt, rows, docker)
        result['fallbackRemoved'].extend(fallback)
        result['checkFaults'].extend(faults)
        result['nativeRemovalAcknowledged'] = confirmed
        result['acknowledged'] = confirmed
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        result['faultType'] = type(error).__name__
    finally:
        context, name = receipt['dockerContext'], receipt['adminContainer']
        try:
            found = docker(context, 'container', 'ls', '-aq', '--no-trunc', '--filter', 'name=^/' + name + '$')
            if found:
                row = json.loads(docker(context, 'inspect', found))[0]
                if row['Id'] != admin_identity(receipt) or row['Name'] != '/' + name or row.get('Config', {}).get('Labels', {}).get(LABEL) != receipt['lease']:
                    raise RuntimeError('Administrator ownership mismatch; refusing stop')
                docker(context, 'stop', '-t', '10', found)
                if docker(context, 'inspect', '--format', '{{.State.Running}}', found) != 'false':
                    raise RuntimeError('Administrator stop remains unconfirmed')
            result['adminStopped'] = True
            # Disposal can finish an in-flight private capture or command. Read
            # the stopped administrator's volume again so a late ledger cannot
            # escape the check observed before disposal.
            rows = ledger_rows(receipt, docker)
            confirmed, fallback, faults = settle_rows(receipt, rows, docker)
            result['fallbackRemoved'].extend(fallback)
            result['checkFaults'].extend(faults)
            result['observedChecks'] = [{'id': row['id'], 'snapshotId': row['snapshotId'],
                'name': row['record']['name'], 'nativeRemoved': bool(row['removed'] and row['removed'].get('removed') is True)} for row in rows]
            result['nativeRemovalAcknowledged'] = result['nativeRemovalAcknowledged'] and confirmed
            result['acknowledged'] = result['acknowledged'] and confirmed and not result['fallbackRemoved']
        except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
            result.update(acknowledged=False, adminStopFaultType=type(error).__name__)
        exclusive_json(previous, result)
    return result
