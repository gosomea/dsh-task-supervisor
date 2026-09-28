#!/usr/bin/env python3
"""Run a keyless DSH profile in separate official task and administrator containers."""
import argparse
import datetime
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time
import uuid


def bounded_run(command, *, timeout=30, check=False, **kwargs):
    """Bound a Docker API wait and reap its owned process group on timeout."""
    process = subprocess.Popen(command, start_new_session=True, **kwargs)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.communicate()
        raise subprocess.TimeoutExpired(command[:4], timeout) from None
    result = subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
    if check:
        result.check_returncode()
    return result


def docker_state(command):
    return bounded_run(command, check=True, stdout=subprocess.PIPE, text=True).stdout.strip()


def cleanup_container(docker, name, lease, log_path):
    """Diagnostic log failure cannot skip cleanup after identity is confirmed."""
    row = {'name': name, 'confirmed': False}
    try:
        inspection = bounded_run(docker + ['inspect', '--format', '{{json .Config.Labels}}', name],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        if json.loads(inspection.stdout).get('dsh.supervisor.topology') != lease:
            raise RuntimeError('refusing cleanup of a container with a different lease')
    except Exception as error:
        row['faultType'] = type(error).__name__
        return row
    try:
        with log_path.open('xb') as log:
            bounded_run(docker + ['logs', name], stdout=log, stderr=subprocess.STDOUT, check=True)
    except Exception as error:
        row['logFaultType'] = type(error).__name__
    try:
        bounded_run(docker + ['stop', '--time', '15', name], stdout=subprocess.DEVNULL, check=True)
    except Exception as error:
        row['stopFaultType'] = type(error).__name__
    try:
        bounded_run(docker + ['rm', '--force', name], stdout=subprocess.DEVNULL, check=True)
        row.update(removed=True, confirmed=True)
    except Exception as error:
        row['faultType'] = type(error).__name__
    return row


def exclusive(path, value):
    with path.open('x') as output:
        json.dump(value, output, indent=2)
        output.write('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--plugin', type=Path, required=True)
    parser.add_argument('--context', required=True)
    parser.add_argument('--image', required=True)
    parser.add_argument('--deadline', type=int, default=600)
    parser.add_argument('--argv-json', type=json.loads, required=True)
    parser.add_argument('--runtime-link-target', action='append', default=[])
    parser.add_argument('--expect-cancelled', action='store_true', help='Cancel only after private command output/ready is observed')
    parser.add_argument('--guest-storage', action='store_true', help='Keep snapshot trees on dedicated Linux Docker volumes; retain them as evidence')
    parser.add_argument('--max-files', type=int, default=10000)
    parser.add_argument('--max-bytes', type=int, default=256 * 1024 * 1024)
    args = parser.parse_args()
    if args.guest_storage and args.expect_cancelled:
        parser.error('guest-storage cancellation requires a dedicated readiness adapter')
    if min(args.deadline, args.max_files, args.max_bytes) < 1 or not isinstance(args.argv_json, list) or not args.argv_json \
            or any(not isinstance(arg, str) or '\0' in arg for arg in args.argv_json):
        parser.error('require a positive deadline and nonempty command argv')
    if not args.image.startswith('sha256:') or len(args.image) != 71:
        parser.error('require an already-cached immutable image id')
    args.root = args.root.resolve()
    args.runtime = args.runtime.resolve()
    args.root.mkdir(mode=0o700)  # Existing runs are never overwritten or silently resumed.
    lease = str(uuid.uuid4())
    docker = ['docker', '--context', args.context]
    exclusive(args.root / 'started.json', {'lease': lease, 'image': args.image, 'context': args.context,
        'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'modelRequests': 0,
        'storagePlacement': 'linux-volumes' if args.guest_storage else 'host-bind',
        'plannedVolumes': [f'dsh-topology-{role}-{lease}' for role in ('client', 'private')] if args.guest_storage else []})
    bounded_run(docker + ['image', 'inspect', args.image], check=True, stdout=subprocess.DEVNULL)
    plugin = args.root / 'plugin'
    plugin.mkdir()
    for name in ('package.json', 'cordis.patch.yml'):
        shutil.copyfile(args.plugin / name, plugin / name)
    shutil.copytree(args.plugin / 'lib', plugin / 'lib')
    (plugin / 'node_modules').mkdir()
    (plugin / 'node_modules/@deepseek-ai').symlink_to('/dsh/apps/cli/node_modules/@deepseek-ai')
    (plugin / 'node_modules/zod').symlink_to('/dsh/node_modules/.pnpm/zod@4.4.3/node_modules/zod')
    for name in ('client', 'private', 'channel', 'admin-home', 'task-home', 'probe'):
        (args.root / name).mkdir()
    probe = args.root / 'probe'
    shutil.copyfile(args.runtime / 'gateway-probe.mjs', probe / 'gateway-probe.mjs')
    (probe / 'node_modules').mkdir()
    (probe / 'node_modules/@deepseek-ai').symlink_to('/dsh/apps/cli/node_modules/@deepseek-ai')
    storage_paths = {role: args.root / role for role in ('client', 'private')}
    volumes = []
    if args.guest_storage:
        for role in ('client', 'private'):
            name = f'dsh-topology-{role}-{lease}'
            bounded_run(docker + ['volume', 'create', '--label', f'dsh.supervisor.topology={lease}', name],
                        check=True, stdout=subprocess.DEVNULL)
            source = docker_state(docker + ['volume', 'inspect', '--format', '{{.Mountpoint}}', name])
            if not source.startswith('/var/lib/docker/volumes/') or not source.endswith('/_data'):
                raise RuntimeError('unexpected dedicated Docker volume location')
            storage_paths[role] = Path(source)
            volumes.append({'role': role, 'name': name, 'path': source})
    socket = '/channel/check.sock'
    deadline = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=args.deadline + 60)
    admin_config = {'socketPath': socket, 'storageRoot': str(storage_paths['client']),
                    'privateStorageRoot': str(storage_paths['private']), 'deadlineAt': deadline.isoformat(),
                    'container': {'context': 'default', 'image': args.image, 'cpus': 2, 'memoryMiB': 8192, 'pids': 256},
                    'runtimeLinkTargets': args.runtime_link_target,
                    'maxFiles': args.max_files, 'maxBytes': args.max_bytes,
                    'commandDeadlineMs': args.deadline * 1000}
    task_config = {'workspace': '/app', 'storageRoot': str(storage_paths['client']),
                   'gatewaySocket': socket, 'image': args.image,
                   'output': str(storage_paths['client'] / 'probe-result.json'), 'deadlineMs': args.deadline * 1000,
                   'argv': args.argv_json, 'runtimeLinkTargets': args.runtime_link_target,
                   'maxFiles': args.max_files, 'maxBytes': args.max_bytes}
    if args.expect_cancelled:
        task_config['cancelFlag'] = str(storage_paths['client'] / 'cancel')
    for role, entry, config in [('admin', 'dsh-task-supervisor/check-gateway', admin_config),
                                ('task', '/probe/gateway-probe.mjs', task_config)]:
        profile = args.root / f'{role}-home/profiles/probe'
        profile.mkdir(parents=True)
        (profile / 'node_modules').mkdir()
        (profile / 'node_modules/@deepseek-ai').symlink_to('/dsh/apps/cli/node_modules/@deepseek-ai')
        (profile / 'node_modules/dsh-task-supervisor').symlink_to('/supervisor')
        (profile / 'package.json').write_text(json.dumps({'private': True, 'type': 'module',
            'dependencies': {'dsh-task-supervisor': 'link:/supervisor',
                             '@deepseek-ai/dsh-subprocess-local': 'link:/dsh/packages/subprocess/subprocess-local'},
            'dsh': {'profile': {'bundles': []}}}))
        (profile / 'cordis.yml').write_text('[]\n')
        (profile / 'cordis.patch.yml').write_text(json.dumps([{'insert': [
            {'id': 'subprocess', 'name': '@deepseek-ai/dsh-subprocess-local'},
            {'id': 'probe', 'name': entry, 'config': config}]}]))
    exclusive(args.root / 'storage.json', {'retainedVolumes': volumes})
    names = []
    result = {'modelRequests': 0, 'lease': lease, 'passed': False}
    try:
        for role in ('admin', 'task'):
            name = f'dsh-topology-{role}-{lease}'
            names.append(name)
            mounts = [(args.runtime / 'dsh-source', '/dsh', True),
                      (args.runtime / 'node24-linux-amd64', '/usr/local/bin/node', True),
                      (plugin, '/supervisor', True), (args.root / 'channel', '/channel', role == 'task'),
                      (storage_paths['client'], str(storage_paths['client']), False),
                      (args.root / f'{role}-home', '/home', False)]
            if role == 'admin':
                mounts += [(storage_paths['private'], str(storage_paths['private']), False),
                           (args.runtime / 'docker-static-amd64', '/usr/local/bin/docker', True),
                           (Path('/var/run/docker.sock'), '/var/run/docker.sock', False)]
            else:
                mounts += [(probe, '/probe', True)]
            command = docker + ['run', '-d', '--platform', 'linux/amd64', '--name', name,
                               '--label', f'dsh.supervisor.topology={lease}', '--network', 'none',
                               '--cpus', '1' if role == 'admin' else '2',
                               '--memory', '1024m' if role == 'admin' else '8192m',
                               '--env', 'DSH_HOME=/home', '--env', 'DSH_TELEMETRY_DISABLED=1',
                               '--env', 'PATH=/usr/local/bin:/usr/bin:/bin', '--entrypoint', '/usr/local/bin/node']
            for source, target, readonly in mounts:
                command += ['--mount', f'type=bind,source={source},target={target}' + (',readonly' if readonly else '')]
            command += [args.image, '/dsh/apps/cli/lib/bin.js', '--profile', 'probe']
            bounded_run(command, check=True, stdout=subprocess.DEVNULL)
            if role == 'admin':
                end = time.monotonic() + 30
                while not (args.root / 'channel/check.sock').exists():
                    state = docker_state(docker + ['inspect', '--format', '{{.State.Running}}', name])
                    if state != 'true' or time.monotonic() > end:
                        raise RuntimeError('administrator profile failed to reach socket readiness')
                    time.sleep(.1)
        end = time.monotonic() + args.deadline + 45
        output = args.root / 'client/probe-result.json'
        while True:
            if args.guest_storage and not output.exists():
                # Export only the small terminal record; large immutable trees remain in Linux.
                copied = bounded_run(docker + ['cp', f'{names[-1]}:{storage_paths["client"] / "probe-result.json"}',
                    str(output.with_suffix('.partial'))], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if copied.returncode == 0:
                    temporary = output.with_suffix('.partial')
                    try:
                        json.loads(temporary.read_text())
                    except json.JSONDecodeError:
                        temporary.unlink()
                    else:
                        temporary.replace(output)
                if copied.returncode and args.expect_cancelled:
                    raise RuntimeError('guest-storage cancellation fixture is not supported')
            if output.exists():
                try:
                    data = json.loads(output.read_text())
                    break
                except json.JSONDecodeError:
                    pass  # The owned producer may still be completing this first write.
            if args.expect_cancelled and not (args.root / 'client/cancel').exists():
                for mapping in (args.root / 'private').glob('snapshot-*.json'):
                    try:
                        snapshot = json.loads(mapping.read_text())
                    except json.JSONDecodeError:
                        continue  # First private capture has not finished publishing the mapping.
                    ready = Path(snapshot['check']) / 'output/ready'
                    if ready.is_file() and ready.read_text() == 'ready':
                        (args.root / 'client/cancel').write_text('observed private command readiness\n')
                        result['cancellationReadinessObserved'] = True
            state = docker_state(docker + ['inspect', '--format', '{{.State.Running}}', names[-1]])
            if state != 'true' or time.monotonic() > end:
                raise RuntimeError('task profile failed to produce a terminal probe record')
            time.sleep(1 if args.guest_storage else .2)
        result['probe'] = data
        terminal = (data.get('check', {}).get('cancelled') is True and result.get('cancellationReadinessObserved') is True) if args.expect_cancelled else (
            data.get('check', {}).get('exitCode') == 0
            and not any(data.get('check', {}).get(k, True) for k in ('cancelled', 'timedOut', 'outputIncomplete')))
        result['passed'] = (terminal and data.get('dockerSocketMounted') is False and data.get('recoveryAcknowledged') is True
                            and data.get('originalUntrackedFile') is True
                            and data.get('snapshot', {}).get('untrackedCaptured') is True
                            and data.get('check', {}).get('changed') == [])
    except Exception as error:
        result['faultType'] = type(error).__name__
        result['fault'] = str(error)[:1024]
    finally:
        cleanup = []
        for name in reversed(names):
            cleanup.append(cleanup_container(docker, name, lease, args.root / f'{name}.log'))
        if any(not item.get('confirmed') for item in cleanup):
            result['passed'] = False
            result.setdefault('faultType', 'cleanup-unconfirmed')
        result['retainedVolumes'] = volumes
        result['cleanup'] = cleanup
        result['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        exclusive(args.root / 'result.json', result)
    print(json.dumps({'passed': result['passed'], 'faultType': result.get('faultType'), 'modelRequests': 0}))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
