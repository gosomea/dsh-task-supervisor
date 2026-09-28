#!/usr/bin/env python3
"""Linux task-namespace cutoff, independent of RPC and monitor lifetimes."""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def living_pids():
    """List owned namespace mutators; PID 1's inert retention sleep is excluded."""
    pids = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit(): continue
        pid = int(entry.name)
        if pid in (1, os.getpid()): continue
        try:
            fields = (entry / 'stat').read_text().rsplit(') ', 1)[1].split()
            status, parent = fields[0], int(fields[1])
            command = (entry / 'cmdline').read_bytes().rstrip(b'\x00').split(b'\x00')
        except (OSError, IndexError):
            continue  # The observed process exited during /proc inspection.
        retention_sleep = parent == 1 and len(command) >= 2 and command[-1] == b'3600' \
            and command[-2].rsplit(b'/', 1)[-1] == b'sleep'
        # Rosetta prepends its emulator argv; match only the inert PID 1 timer,
        # never an Agent process or an arbitrary reparented background command.
        if status == 'Z' or retention_sleep: continue
        pids.append(pid)
    return pids


def run(config):
    root = Path('/evalhome/run')
    output = root / 'cutoff-result.json'
    if output.exists(): raise FileExistsError('cutoff result already sealed')
    root.joinpath('watchdog-ready.json').write_text(json.dumps({'pid': os.getpid(),
        'deadlineAtUnix': config['deadlineAtUnix'], 'sessionId': config['sessionId']}))
    while time.time() < config['deadlineAtUnix'] and not (root / 'cutoff-now.json').exists():
        time.sleep(min(0.1, max(0, config['deadlineAtUnix'] - time.time())))
    triggered = time.time()
    reason = 'deadline' if triggered >= config['deadlineAtUnix'] else 'native-terminal'
    initial = living_pids()
    frozen_at = None
    if reason == 'deadline':
        for pid in initial:
            try: os.kill(pid, signal.SIGSTOP)
            except ProcessLookupError: pass
        frozen_at = time.time()
    cutoff_head = None
    capture_error = None
    try:
        cutoff_head = subprocess.check_output(['git', '-C', config['cwd'], 'rev-parse', 'HEAD'], timeout=2, stderr=subprocess.DEVNULL).decode().strip()
    except (OSError, subprocess.SubprocessError) as error:
        capture_error = type(error).__name__
    captured_at = time.time()
    # Every process in this namespace belongs to this fresh task container.
    # Killing the native Host also prevents timers or continuations being sent.
    for pid in initial:
        try: os.kill(pid, signal.SIGTERM)
        except ProcessLookupError: pass
    if reason == 'deadline':
        for pid in initial:
            try: os.kill(pid, signal.SIGCONT)
            except ProcessLookupError: pass
    wait = time.monotonic() + 5
    while living_pids() and time.monotonic() < wait: time.sleep(0.05)
    remaining = living_pids()
    for pid in remaining:
        try: os.kill(pid, signal.SIGKILL)
        except ProcessLookupError: pass
    wait = time.monotonic() + 5
    while living_pids() and time.monotonic() < wait: time.sleep(0.05)
    final = living_pids()
    head = None
    if not final:
        try:
            head = subprocess.check_output(['git', '-C', config['cwd'], 'rev-parse', 'HEAD'], timeout=2, stderr=subprocess.DEVNULL).decode().strip()
        except (OSError, subprocess.SubprocessError) as error:
            capture_error = capture_error or type(error).__name__
    record = {'schemaVersion': 1, 'reason': reason, 'triggeredAtUnix': triggered,
        'deadlineAtUnix': config['deadlineAtUnix'], 'sessionId': config['sessionId'],
        'frozenAtUnix': frozen_at, 'cutoffEnforcementLagSec': max(0, triggered - config['deadlineAtUnix']) if reason == 'deadline' else 0,
        'stoppedProcessCount': len(initial), 'remainingMutatorCount': len(final),
        'remainingProcesses': [{'pid': pid, 'comm': Path('/proc', str(pid), 'comm').read_text().strip()} for pid in final],
        'acknowledged': not final, 'headCaptureError': capture_error, 'cutoffHeadCommit': cutoff_head, 'capturedAtUnix': captured_at,
        'sealedHeadCommit': head, 'lateCommitDetected': head is not None and head != cutoff_head,
        'sealedAtUnix': time.time()}
    temporary = output.with_name('cutoff-result-' + str(os.getpid()) + '.tmp')
    with temporary.open('x') as stream:
        json.dump(record, stream, indent=2); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
    os.link(temporary, output)
    temporary.unlink()
    descriptor = os.open(root, os.O_RDONLY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)
    return record


if __name__ == '__main__':
    run(json.loads(Path(sys.argv[1]).read_text()))
