#!/usr/bin/env python3
"""Keyless Linux regressions for deadline cutoff and escaped task processes."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import time
import uuid

from control_flow import exclusive_json
from launch_host import docker, owned, LABEL


def run_case(root, case, image, context='colima-dsh-independent-eval'):
    root = Path(root)
    root.mkdir(mode=0o700)
    run = root / 'run'; run.mkdir()
    shutil.copy2(Path(__file__).with_name('cutoff_watchdog.py'), run / 'cutoff_watchdog.py')
    shutil.copy2(Path(__file__).with_name('committed_patch.py'), run / 'committed_patch.py')
    lease = str(uuid.uuid4()); container = 'dsh-watchdog-' + lease[:12]
    exclusive_json(root / 'started.json', {'case': case, 'lease': lease, 'container': container,
        'modelRequests': 0, 'cpus': 0.1, 'memoryMiB': 128, 'startedAtUnix': time.time(),
        'watchdogSha256': hashlib.sha256((run / 'cutoff_watchdog.py').read_bytes()).hexdigest()})
    try:
        docker(context, 'run', '-di', '--name', container, '--platform', 'linux/amd64',
            '--label', LABEL + '=' + lease, '--cpus', '.1', '--memory', '128m',
            '-v', str(root) + ':/evalhome', '--entrypoint', '/bin/bash', image,
            '-c', 'while true; do sleep 3600; done')
        owned(context, container, lease)
        docker(context, 'exec', container, '/bin/bash', '-ec',
            'mkdir /tmp/watchdog-fixture; cd /tmp/watchdog-fixture; git init -q; '
            'git config user.name Watchdog; git config user.email watchdog@example.invalid; '
            'printf initial > marker; git add marker; git commit -qm initial')
        base = docker(context, 'exec', container, 'git', '-C', '/tmp/watchdog-fixture', 'rev-parse', 'HEAD')
        if case == 'late-commit':
            actor = '''import os,signal,subprocess,time
os.chdir('/tmp/watchdog-fixture')
def finish(*_):
 open('marker','w').write('late')
 subprocess.run(['git','add','marker'],check=True)
 subprocess.run(['git','commit','-qm','late'],check=True)
 raise SystemExit(0)
signal.signal(signal.SIGTERM,finish)
while True: time.sleep(.05)
'''
        else:
            actor = '''import time
while True:
 open('/evalhome/run/actor-heartbeat','w').write(str(time.time()))
 time.sleep(.05)
'''
        docker(context, 'exec', '-d', container, 'setsid', 'python3', '-c', actor)
        if case == 'invalid-head':
            docker(context, 'exec', container, 'rm', '/tmp/watchdog-fixture/.git/HEAD')
        deadline = time.time() + 10
        exclusive_json(run / 'watchdog-config.json', {'deadlineAtUnix': deadline,
            'sessionId': 'keyless-' + case, 'cwd': '/tmp/watchdog-fixture'})
        docker(context, 'exec', '-d', container, 'python3', '/evalhome/run/cutoff_watchdog.py', '/evalhome/run/watchdog-config.json')
        wait = time.monotonic() + 25
        cutoff = None
        while time.monotonic() < wait:
            path = run / 'cutoff-result.json'
            if path.exists():
                cutoff = json.loads(path.read_text())
                break
            time.sleep(.05)
        if cutoff is None: raise TimeoutError('watchdog did not seal')
        if not cutoff['acknowledged'] or cutoff['remainingMutatorCount'] != 0:
            raise RuntimeError('escaped actors remained alive')
        result = {'schemaVersion': 1, 'kind': 'keyless-native-deadline-check', 'case': case,
                  'passed': True, 'modelRequests': 0, 'cutoff': cutoff}
        if case == 'late-commit':
            if not cutoff['lateCommitDetected'] or cutoff['cutoffHeadCommit'] != base:
                raise RuntimeError('late TERM commit fixture did not exercise HEAD drift')
            docker(context, 'exec', container, 'python3', '/evalhome/run/committed_patch.py',
                   '/tmp/watchdog-fixture', base, '/evalhome/run/submission', '--head', cutoff['cutoffHeadCommit'])
            receipt = json.loads((run / 'submission/receipt.json').read_text())
            if receipt['patchBytes'] != 0 or not receipt['headChangedSinceCutoff']:
                raise RuntimeError('late commit was included in submitted patch')
            result['submission'] = receipt
        elif case == 'invalid-head':
            if not cutoff['headCaptureError'] or cutoff['cutoffHeadCommit'] is not None:
                raise RuntimeError('HEAD failure fixture did not exercise cutoff capture error')
        else:
            heartbeat = run / 'actor-heartbeat'
            before = heartbeat.read_bytes()
            time.sleep(.3)
            if heartbeat.read_bytes() != before: raise RuntimeError('setsid actor kept writing after cutoff')
        return result
    finally:
        owned(context, container, lease)
        docker(context, 'stop', '-t', '2', container)
        stopped = docker(context, 'inspect', '--format', '{{.State.Running}}', container) == 'false'
        docker(context, 'rm', container)
        exclusive_json(root / 'cleanup.json', {'containerStopped': stopped, 'containerRemoved': True})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('image')
    args = parser.parse_args()
    args.root.mkdir(mode=0o700)
    for case in ('late-commit', 'invalid-head', 'setsid-actor'):
        root = args.root / case
        result = run_case(root, case, args.image)
        exclusive_json(root / 'result.json', result)
        print(json.dumps({'case': case, 'passed': result['passed']}), flush=True)


if __name__ == '__main__':
    main()
