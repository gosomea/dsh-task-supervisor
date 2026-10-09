#!/usr/bin/env python3
"""One serial frozen matrix owner; reconnect original positions, never rescue."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import shutil

from records import exclusive_json


def validate_release(release, root):
    for relative, expected in release['runnerFilesSha256'].items():
        path = root / relative
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('frozen runner differs: ' + relative)
    for filename, expected in release.get('runtimeFilesSha256', {}).items():
        path = Path(filename)
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('frozen runtime input differs')


def next_operation(directory):
    if (directory / 'result.json').exists(): return None
    if (directory / 'collection.json').exists():
        return 'grade' if (directory / 'collection-complete.json').exists() else 'collect'
    if (directory / 'terminal.json').exists(): return 'collect'
    if (directory / 'started.json').exists(): return 'observe'
    if (directory / 'delivery-intent.json').exists():
        raise RuntimeError('uncertain original delivery; no new model submission')
    return 'run'


def capacity_gate(release, runs):
    """Sample actual remaining capacity before any new position delivery."""
    bounds = release['capacity']
    info = json.loads(subprocess.check_output(['docker', '--context', bounds['dockerContext'],
        'info', '--format', '{{json .}}'], timeout=30))
    output = subprocess.check_output(['colima', 'ssh', '--profile', bounds['colimaProfile'], '--',
        'df', '-B1', '--output=avail', '/var/lib/docker'], timeout=30).decode().splitlines()
    free = int(output[-1].strip())
    host_free = shutil.disk_usage(runs).free
    observed = {'dockerFreeBytes': free, 'hostFreeBytes': host_free,
        'cpus': info['NCPU'], 'memoryBytes': info['MemTotal'], 'atUnix': time.time()}
    if (free < bounds['minimumDockerFreeBytes'] or host_free < bounds['minimumHostFreeBytes']
            or info['NCPU'] < bounds['requiredCpus'] or info['MemTotal'] < bounds['requiredMemoryBytes']):
        raise RuntimeError('actual capacity insufficient; no model delivery')
    return observed


def run_batch(root, runs, python, domain, *, invoke=subprocess.run):
    release = json.loads((root / 'release.json').read_text())
    order = json.loads((root / 'order.json').read_text())
    if hashlib.sha256((root / 'order.json').read_bytes()).hexdigest() != release['orderSha256']:
        raise ValueError('frozen order differs')
    validate_release(release, root)
    runs.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (runs / 'batch.lock').open('a') as lease:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        exclusive_json(runs / 'batch-events' / (str(time.time_ns()) + '.json'),
            {'kind': 'owner', 'pid': os.getpid(), 'releaseSha256': hashlib.sha256((root / 'release.json').read_bytes()).hexdigest()})
        for position in order['positions']:
            validate_release(release, root)
            directory = runs / position['id']; spec = root / 'specs' / (position['id'] + '.json')
            if hashlib.sha256(spec.read_bytes()).hexdigest() != release['specsSha256'][position['id']]:
                raise ValueError('position specification differs')
            while operation := next_operation(directory):
                if operation == 'run' and not (directory / 'prepare-intent.json').exists():
                    capacity = capacity_gate(release, runs)
                    exclusive_json(runs / 'batch-events' / (str(time.time_ns()) + '.json'),
                        {'kind': 'capacity', 'position': position['id'], **capacity})
                directory.mkdir(parents=True, exist_ok=True, mode=0o700)
                with (directory / ('batch-' + str(time.time_ns()) + '.log')).open('x') as log:
                    outcome = invoke([python, str(root / 'runner/sandbox-run/run.py'), '--domain', domain,
                        operation, '--spec', str(spec), '--out', str(directory)], stdout=log, stderr=subprocess.STDOUT)
                if outcome.returncode:
                    exclusive_json(runs / 'batch-events' / (str(time.time_ns()) + '.json'),
                        {'kind': 'attention', 'position': position['id'], 'operation': operation,
                         'exitCode': outcome.returncode, 'newDeliveryStopped': True})
                    raise RuntimeError('original position requires reconciliation: ' + position['id'] + ' / ' + operation)
            result = json.loads((directory / 'result.json').read_text())
            if result['terminal']['infrastructureFault'] or result['gradingFault']:
                exclusive_json(runs / 'batch-events' / (str(time.time_ns()) + '.json'),
                    {'kind': 'attention', 'position': position['id'], 'operation': 'sealed-result',
                     'reason': result['terminal']['firstStopReason'], 'gradingFault': result['gradingFault'],
                     'newDeliveryStopped': True})
                raise RuntimeError('infrastructure/grading fault sealed; stop new delivery')
        exclusive_json(runs / 'batch-events' / (str(time.time_ns()) + '.json'), {'kind': 'matrix-sealed', 'planned': len(order['positions'])})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('release_root', type=Path)
    parser.add_argument('runs', type=Path)
    parser.add_argument('--python', default=sys.executable)
    parser.add_argument('--domain', default='localhost:8090')
    args = parser.parse_args()
    run_batch(args.release_root, args.runs, args.python, args.domain)
