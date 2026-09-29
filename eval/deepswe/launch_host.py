#!/usr/bin/env python3
"""Start a lease-labelled native DSH Web Host in an official task image.

The native Host is a PID 1 child. At cutoff the task process namespace is stopped;
the container remains alive for committed-patch extraction. No Docker socket
is exposed to the task. Heavy-resource admission is owned by the batch driver.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import uuid

from control_flow import controller_overlay, exclusive_json
from check_gateway_adapter import prepare as prepare_gateway, arm as arm_gateway, clean_checks

LABEL = 'dsh.deepswe.attempt'


def docker(context, *args, timeout=30, input=None):
    return subprocess.run(['docker', '--context', context, *map(str, args)], input=input,
        capture_output=True, text=True, check=True, timeout=timeout).stdout.strip()


def owned(context, container, lease, container_id=None):
    if container_id is not None:
        row = json.loads(docker(context, 'inspect', container))[0]
        if row['Id'] != container_id or row['Name'] != '/' + container or row.get('Config', {}).get('Labels', {}).get(LABEL) != lease:
            raise RuntimeError('container identity differs from this attempt')
        return
    label = docker(context, 'inspect', '--format', '{{index .Config.Labels "' + LABEL + '"}}', container)
    if label != lease:
        raise RuntimeError('container does not belong to this attempt')


def launch(spec):
    home, runtime, template = map(Path, (spec['home'], spec['runtime'], spec['template']))
    if home.exists():
        raise FileExistsError('attempt home already allocated; reconcile instead of relaunching')
    condition = spec['condition']
    profile = 'supervisor-eval' if condition.startswith('supervisor-') else 'eval-baseline'
    image = spec['imageDigest']
    if not re.fullmatch(r'(?:[^\s]+@)?sha256:[0-9a-f]{64}', image):
        raise ValueError('immutable task image digest required')
    if spec.get('mainCpus', 2) != 2 or spec.get('mainMemoryMiB', 8192) != 8192:
        raise ValueError('DeepSWE official main resources differ')
    if spec.get('netctlImage') and not re.fullmatch(r'(?:[^\s]+@)?sha256:[0-9a-f]{64}', spec['netctlImage']):
        raise ValueError('Network helper must use an immutable image digest')
    if spec.get('formal') and (spec.get('storageMiB') != 20480 or
            spec.get('storageEnforcement') != 'official-docker-metadata-only'):
        raise ValueError('Official Docker storage metadata must be frozen without inventing a disk quota')
    for port in (spec['port'],):
        if not isinstance(port, int) or not 1024 <= port <= 65535:
            raise ValueError('invalid dedicated host port')
    context = spec.get('dockerContext', 'colima-dsh-independent-eval')
    lease = spec.get('lease') or str(uuid.uuid4())
    container = 'dsh-deepswe-' + lease[:12]
    home.mkdir(parents=True, mode=0o700)
    (home / 'run').mkdir(mode=0o700)
    exclusive_json(home / 'run/launch-intent.json', {**spec, 'lease': lease, 'container': container})
    shutil.copytree(template / 'profiles' / profile, home / 'profiles' / profile, symlinks=True)
    shutil.copy2(template / '.credentials.yaml', home / '.credentials.yaml')
    os.chmod(home / '.credentials.yaml', 0o600)
    gateway_receipt, gateway_patch, gateway_mounts = prepare_gateway(spec, lease, docker)
    overlay = home / 'run/controller.patch.yml'
    overlay.write_text(controller_overlay(condition, runtime / 'dsh-source/packages/bundle/web-app/presets/standard.patch.yml') + spec.get('extraOverlay', ''))
    # The native Host gets its own group; the watchdog also tracks detached
    # native subprocesses through the container's process namespace.
    wrapper = home / 'run/host.sh'
    runner_source = Path(spec.get('runner', Path(__file__).resolve().parent))
    runner = home / 'run/runner'
    runner.mkdir()
    for filename in ('control_flow.py', 'control_rpc.py', 'committed_patch.py', 'cutoff_watchdog.py', 'tcp_proxy.mjs'):
        source = runner_source / filename
        if source.exists(): shutil.copy2(source, runner / filename)
    if (runner_source / 'model-route').is_dir():
        shutil.copytree(runner_source / 'model-route', runner / 'model-route')
    if spec.get('keylessCapabilityProbe'):
        if spec.get('formal'): raise ValueError('Formal profile cannot load a keyless probe')
        shutil.copy2(spec['keylessCapabilityProbe'], runner / 'profile-probe.mjs')
    wrapper.write_text('''#!/bin/bash
set -eu
export DSH_HOME=/evalhome
export DSH_TELEMETRY_DISABLED=1
mkdir -p /evalhome/run
patch_args=(--patch /evalhome/run/controller.patch.yml)
if [[ -n "$4" ]]; then patch_args+=(--patch "$4"); fi
/eval/node24 /runner/tcp_proxy.mjs "$2" "$3" >> /evalhome/run/proxy.log 2>&1 &
setsid /eval/node24 /dsh/apps/cli/lib/bin.js --profile "$1" "${patch_args[@]}" --no-open --host 127.0.0.1 --trusted-host "127.0.0.1:$2" --port "$3" >> /evalhome/run/host.log 2>&1 &
host=$!
printf '%s\\n' "$host" > /evalhome/run/host.pid
wait "$host" || true
printf 'exited\\n' > /evalhome/run/host.exited
while true; do sleep 3600; done
''')
    (home / 'run/host.log').touch(mode=0o600)
    args = ['run', '-di', '--platform', 'linux/amd64', '--name', container,
        '--label', LABEL + '=' + lease, '--cpus', '2', '--memory', '8192m',
        '--workdir', '/app', '-e', 'DSH_PERMISSION_MODE=danger-full-access',
        '-v', str(home) + ':/evalhome', '-v', str(runtime / 'node24-linux-amd64') + ':/eval/node24:ro',
        '-v', str(runtime / 'dsh-source') + ':/dsh:ro', '-v', str(runner) + ':/runner:ro',
        '-p', f'127.0.0.1:{spec["port"]}:{spec["port"]}', '--entrypoint', '/bin/bash']
    if condition.startswith('supervisor-'):
        args[-2:-2] = ['-v', str(runtime / 'plugin-source') + ':/plugin:ro']
    for mount in spec.get('mounts', []):
        args[-2:-2] = ['-v', mount]
    for mount in gateway_mounts:
        args[-2:-2] = ['--mount', mount]
    args += [image, '/evalhome/run/host.sh', profile, str(spec['port']), str(spec.get('internalPort', spec['port'] + 1)), gateway_patch]
    container_id = docker(context, *args)
    try:
        exclusive_json(home / 'run/container-created.json', {'container': container, 'containerId': container_id,
            'lease': lease, 'dockerContext': context, 'imageDigest': image})
        owned(context, container, lease, container_id)
        # Formal admission requires a pinned privileged helper that seals only this
        # task namespace before any Session prompt is delivered.
        if spec.get('netctlImage'):
            addresses = docker(context, 'exec', container_id, 'getent', 'ahostsv4', 'host.docker.internal').split()
            if not addresses:
                raise RuntimeError('Model gateway DNS returned no address')
            gateway = addresses[0]
            import ipaddress
            gateway = str(ipaddress.IPv4Address(gateway))
            docker(context, 'exec', '-i', container, 'tee', '-a', '/etc/hosts',
                   input=f'{gateway} host.docker.internal\n')
            rules = ('iptables -A OUTPUT -o lo -j ACCEPT; '
                     'iptables -A OUTPUT -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT; '
                     f'iptables -A OUTPUT -d {gateway}/32 -p tcp --dport 15721 -j ACCEPT; '
                     'iptables -P OUTPUT DROP')
            docker(context, 'run', '--rm', '--platform', 'linux/amd64',
                   '--label', LABEL + '=' + lease, '--network', 'container:' + container,
                   '--cap-add', 'NET_ADMIN', '--entrypoint', '/bin/sh', spec['netctlImage'], '-ec', rules)
        elif spec.get('formal', False):
            raise RuntimeError('formal task network is not sealed')
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if '?token=' in (home / 'run/host.log').read_text():
                break
            if (home / 'run/host.exited').exists():
                raise RuntimeError('native Host exited; retain private startup evidence')
            time.sleep(1)
        else:
            raise TimeoutError('native Host readiness timeout')
        receipt = {'schemaVersion': 1, 'lease': lease, 'container': container,
                   'containerId': container_id, 'dockerContext': context, 'home': str(home),
                   'port': spec['port'], 'internalPort': spec.get('internalPort', spec['port'] + 1), 'profile': profile, 'condition': condition,
                   'imageDigest': image, 'storageMiB': spec.get('storageMiB'), 'storageEnforcement': spec.get('storageEnforcement'),
                   'runnerFiles': {str(path.relative_to(runner)): __import__('hashlib').sha256(path.read_bytes()).hexdigest() for path in runner.rglob('*') if path.is_file()}, 'controllerOverlaySha256': __import__('hashlib').sha256(overlay.read_bytes()).hexdigest(), 'networkSealed': bool(spec.get('netctlImage'))}
        if gateway_receipt:
            receipt['independentGateway'] = gateway_receipt
        exclusive_json(home / 'run/launch-receipt.json', receipt)
        return receipt
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        partial = {'home': str(home), 'dockerContext': context, 'container': container,
                   'containerId': container_id, 'lease': lease}
        if gateway_receipt:
            partial['independentGateway'] = gateway_receipt
        try:
            cleanup = abort_before_delivery(partial)
        except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as cleanup_error:
            cleanup = {'cleanupAcknowledged': False, 'errorType': type(cleanup_error).__name__}
        exclusive_json(home / 'run/launch-fault.json', {'errorType': type(error).__name__,
            'containerId': container_id, 'lease': lease, 'retryAllowed': False, 'cleanup': cleanup})
        raise



def arm_watchdog(receipt, started):
    """Start the native deadline enforcer before the first model delivery."""
    root = Path(receipt['home']) / 'run'
    config = {'deadlineAtUnix': started['deadlineAtUnix'], 'sessionId': started['sessionId'], 'cwd': started['cwd']}
    exclusive_json(root / 'watchdog-config.json', config)
    owned(receipt['dockerContext'], receipt['container'], receipt['lease'], receipt['containerId'])
    docker(receipt['dockerContext'], 'exec', '-d', receipt['containerId'], 'python3',
           '/runner/cutoff_watchdog.py', '/evalhome/run/watchdog-config.json')
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if (root / 'watchdog-ready.json').exists():
            if receipt.get('independentGateway'):
                arm_gateway(receipt['independentGateway'], started, docker)
            return
        time.sleep(0.1)
    raise TimeoutError('native deadline enforcer not ready')


def abort_before_delivery(receipt, started=None):
    """Close started actors on arm failure; no uncertain prompt is redelivered."""
    result = {'taskStopped': False, 'cleanupAcknowledged': False}
    try:
        owned(receipt['dockerContext'], receipt['container'], receipt['lease'], receipt['containerId'])
        docker(receipt['dockerContext'], 'stop', '-t', '5', receipt['containerId'])
        result['taskStopped'] = docker(receipt['dockerContext'], 'inspect', '--format', '{{.State.Running}}', receipt['containerId']) == 'false'
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        result['taskStopFaultType'] = type(error).__name__
    finally:
        if receipt.get('independentGateway'):
            result['independentGateway'] = clean_checks(receipt['independentGateway'], started or {'sessionId': None, 'deadlineAtUnix': None}, docker)
    result['cleanupAcknowledged'] = result['taskStopped'] and (not receipt.get('independentGateway') or result['independentGateway']['acknowledged'])
    return result


def quiesce(receipt, started, submission_dir):
    """Stop native task actors, export cutoff commits, and stop the owned container."""
    context, container, lease = (receipt[key] for key in ('dockerContext', 'container', 'lease'))
    owned(context, container, lease, receipt['containerId'])
    outcome = None
    try:
        root = Path(receipt['home']) / 'run'
        trigger = root / 'cutoff-now.json'
        if not trigger.exists():
            exclusive_json(trigger, {'atUnix': time.time(), 'sessionId': started['sessionId']})
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if (root / 'cutoff-result.json').exists():
                cutoff = json.loads((root / 'cutoff-result.json').read_text())
                break
            time.sleep(0.1)
        else:
            raise TimeoutError('native cutoff did not acknowledge quiescence')
        if not cutoff['acknowledged'] or cutoff['sessionId'] != started['sessionId'] or cutoff.get('headCaptureError') or not cutoff.get('cutoffHeadCommit'):
            raise RuntimeError('native mutators are not quiescent')
        output = '/evalhome/run/submission'
        docker(context, 'exec', receipt['containerId'], 'python3', '/runner/committed_patch.py',
               started['cwd'], started['baseCommit'], output, '--head', cutoff['cutoffHeadCommit'], timeout=60)
        # submission_dir belongs to private evidence; the exporter created the source
        # exclusively and docker cp must not replace an existing host directory.
        destination = Path(submission_dir)
        if destination.exists():
            raise FileExistsError('submission already exists')
        docker(context, 'cp', receipt['containerId'] + ':' + output, str(destination), timeout=60)
        extracted = json.loads((destination / 'receipt.json').read_text())
        if extracted['headCommit'] != (cutoff['cutoffHeadCommit']):
            raise RuntimeError('HEAD changed after cutoff quiescence')
        outcome = {'acknowledged': True, 'submissionDir': str(destination), 'cutoff': cutoff}
        return outcome
    finally:
        # Stop even if HEAD capture, acknowledgement, export or copy failed.
        try:
            owned(context, container, lease, receipt['containerId'])
            docker(context, 'stop', '-t', '5', receipt['containerId'], timeout=30)
            if docker(context, 'inspect', '--format', '{{.State.Running}}', receipt['containerId']) != 'false':
                raise RuntimeError('owned task container remains running')
        finally:
            if receipt.get('independentGateway'):
                gateway = clean_checks(receipt['independentGateway'], started, docker)
                if outcome is not None:
                    outcome['independentGateway'] = gateway
                if not gateway['acknowledged']:
                    raise RuntimeError('independent checks did not acknowledge quiescence')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('spec', type=Path)
    args = parser.parse_args()
    print(json.dumps(launch(json.loads(args.spec.read_text()))))


if __name__ == '__main__':
    main()
