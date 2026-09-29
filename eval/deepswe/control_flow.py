#!/usr/bin/env python3
"""Durable admission and observation for one frozen DeepSWE attempt.

An unresolved mutation intent is never replayed. Monitoring may resume against
its original Session; model admission and plan approval may not be repeated.
"""
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import time
import tempfile
import uuid

CONDITIONS = ('goal', 'plan', 'supervisor-log', 'supervisor-independent')
MODEL = {'provider': 'deepseek-codebuddy', 'model': 'deepseek-v4.1-flash'}
GOAL_ROWS = ('goal', 'goal-round-driver', 'command-goal', 'tool-goal')


def exclusive_json(path, value):
    """Publish a complete fsynced record atomically without replacing evidence."""
    path = Path(path)
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf8') as stream:
            json.dump(value, stream, indent=2, ensure_ascii=False)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path)
        directory = os.open(str(path.parent), os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        os.unlink(temporary)


def controller_overlay(condition, standard_preset=None):
    """Disable foreign continuation owners through public profile composition."""
    if condition not in CONDITIONS:
        raise ValueError('unknown condition')
    rows = [] if condition == 'goal' else list(GOAL_ROWS)
    if condition != 'plan':
        rows.append('plan-mode')
    # Session-title requests are auxiliary and must not consume benchmark time.
    rows.append('session-title-llm')
    overlay = ''.join(f'- id: {row}\n  disabled: true\n' for row in rows)
    if standard_preset is not None:
        # The shipped Web standard preset owns its own command/tool rows.
        # Replacing its public declaration retains every unrelated plugin and
        # deferred !!js expression while disabling foreign controller children.
        lines = Path(standard_preset).read_text().splitlines()
        start = lines.index('    - id: preset-standard')
        declaration = [line[4:] if line.startswith('    ') else line for line in lines[start:]]
        targets = set() if condition == 'goal' else {'command-goal', 'tool-goal'}
        if condition != 'plan': targets.add('planning')
        amended = []
        for line in declaration:
            amended.append(line)
            if line.strip().startswith('- id: ') and line.strip()[6:] in targets:
                indent = len(line) - len(line.lstrip())
                amended.append(' ' * (indent + 2) + 'disabled: true')
        overlay += '\n'.join(amended) + '\n'
    return overlay


class Journal:
    """An attempt's immutable records and exclusive live-controller lease."""
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def read(self, name):
        path = self.root / name
        return json.loads(path.read_text()) if path.exists() else None

    def write(self, name, value):
        exclusive_json(self.root / name, value)
        return value

    @contextmanager
    def controller(self):
        with (self.root / 'controller.lock').open('a') as stream:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise RuntimeError('another controller owns this attempt') from error
            try:
                yield
            finally:
                fcntl.flock(stream, fcntl.LOCK_UN)

    def mutate_once(self, action, payload, send):
        """Persist intent before transmission; a missing receipt is uncertain."""
        intent = {'schemaVersion': 1, 'action': action, 'requestId': str(uuid.uuid4()),
                  'atUnix': time.time(), 'payload': payload}
        self.write(action + '-intent.json', intent)
        result = send(intent['requestId'])
        return self.write(action + '-receipt.json', {
            'schemaVersion': 1, 'action': action, 'requestId': intent['requestId'],
            'atUnix': time.time(), 'result': result})


def projection_values(document):
    """Read full persisted projections, retaining Supervisor job lineage."""
    return {key: row.get('val') for key, row in document['record']['rows'].items()}


def observe(condition, values, running, approved, native_stop=None):
    """Classify native completion without treating blocked/off as success."""
    if condition not in CONDITIONS:
        raise ValueError('unknown condition')
    goal = (values.get('goal') or {}).get('current') or {}
    goal_state = goal.get('goal') or {}
    supervisor = values.get('taskSupervisor') or {}
    task = supervisor.get('current') or {}
    plan = values.get('plan') or {}
    owners = []
    if goal_state:
        owners.append('goal')
    if plan.get('active'):
        owners.append('plan')
    if task:
        owners.append('supervisor')
    expected = 'supervisor' if condition.startswith('supervisor-') else condition
    conflict = any(owner != expected for owner in owners)
    stats = values.get('sessionStats') or {}
    idle = not running and stats.get('openStep') is None and not stats.get('pendingCalls')
    phase = goal_state.get('phase') if condition == 'goal' else task.get('phase')
    if condition == 'plan':
        phase = 'planning' if plan.get('active') else 'implementation'
    response = ((values.get('turnOutline') or {}).get('turns') or [{}])[-1].get('response')
    status = 'running'
    native_finished = False
    if conflict:
        status = 'controller-conflict'
    elif condition == 'plan' and approved and not plan.get('active') and idle and response:
        status, native_finished = 'native-complete', True
    elif phase == 'complete' and idle:
        status, native_finished = 'native-complete', True
    elif phase == 'blocked' and idle:
        status = 'native-blocked'
    elif phase == 'cleared' or (task and not task.get('enabled', True)):
        status = 'controller-off'
    elif phase == 'paused':
        status = 'internal-fault' if task.get('pauseReason') == 'review-fault' else 'paused'
    elif condition == 'goal' and phase == 'active' and idle and native_stop is not None:
        status = 'native-stopped'
    return {'status': status, 'nativeFinished': native_finished, 'taskPhase': phase,
            'pauseReason': task.get('pauseReason'), 'controllerOwners': owners,
            'idle': idle, 'reviewJobs': supervisor.get('reviewJobs', []),
            'reviewFault': task.get('reviewFault'), 'taskId': task.get('id'),
            'planVersion': task.get('planVersion'), 'everApproved': task.get('everApproved', False),
            'nativeStop': native_stop if status == 'native-stopped' else None}


def begin(rpc, journal, condition, instruction, base_commit, attempt_id, *,
          cwd='/app', deadline_sec=10800, preset='standard', clock=time.time, before_delivery=None):
    """Bind a new Session and reserve started evidence before model delivery."""
    if journal.read('started.json') is not None or journal.read('start-intent.json') is not None:
        raise RuntimeError('attempt already reserved; reconcile original Session without redelivery')
    if condition not in CONDITIONS or deadline_sec <= 0:
        raise ValueError('invalid condition or deadline')
    workspace = rpc.call('workspace/create', {'path': cwd})['workspace']
    session_id = rpc.call('session/create', {'workspaceId': workspace['workspaceId'],
                                            'agentPreset': preset})['sessionId']
    rows = rpc.call('session/list')['items']
    row = next(row for row in rows if row['sessionId'] == session_id)
    if row.get('cwd') != cwd:
        raise RuntimeError('Session workspace binding differs from intended task root')
    title = 'DeepSWE ' + attempt_id
    rpc.call('session/rename', {'sessionId': session_id, 'title': title})
    selected = rpc.call('session/selectModel', {'sessionId': session_id, **MODEL})['selected']
    if any(selected.get(key) != value for key, value in MODEL.items()):
        raise RuntimeError('effective model selection differs from frozen route')
    permission = rpc.command(session_id, '/permission danger-full-access')['result']
    if permission['kind'] != 'success':
        raise RuntimeError('permission preset admission failed')
    if condition == 'plan':
        result = rpc.command(session_id, '/plan')['result']
        if result['kind'] != 'success':
            raise RuntimeError('native Plan admission failed')
    started_at = clock()
    started = journal.write('started.json', {
        'schemaVersion': 1, 'id': attempt_id, 'condition': condition,
        'sessionId': session_id, 'mainSessionId': session_id,
        'workspaceId': workspace['workspaceId'], 'cwd': cwd, 'baseCommit': base_commit,
        'startedAtUnix': started_at, 'deadlineAtUnix': started_at + deadline_sec,
        'timeLimitSec': deadline_sec, 'modelSelection': selected,
        'instructionSha256': hashlib.sha256(instruction.encode()).hexdigest(),
        'agentPreset': preset, 'permissionPreset': 'danger-full-access', 'sessionTitle': title})
    if before_delivery is not None:
        before_delivery(started)
    def send(request_id):
        if condition == 'plan':
            result = rpc.prompt(session_id, instruction, request_id=request_id)
            if not result.get('accepted'):
                raise RuntimeError('native Plan prompt admission failed')
            return {'accepted': True}
        prefix = '/goal ' if condition == 'goal' else '/task new '
        if condition == 'goal':
            journal.write('approval-intent.json', {'schemaVersion': 1, 'action': 'approval',
                'requestId': request_id, 'sessionId': session_id, 'atUnix': clock(),
                'transport': 'native-goal-command', 'decision': 'initial-user-authorization'})
        result = rpc.command(session_id, prefix + instruction)['result']
        if result['kind'] != 'success':
            raise RuntimeError('native controller start failed')
        if condition == 'goal':
            journal.write('approval-receipt.json', {'schemaVersion': 1, 'sessionId': session_id,
                'requestId': request_id, 'atUnix': clock(), 'transport': 'native-goal-command',
                'decision': 'initial-user-authorization'})
        return {'kind': 'success'}
    journal.mutate_once('start', {'sessionId': session_id, 'condition': condition,
                                'instructionSha256': started['instructionSha256']}, send)
    return started


def approve_supervisor(rpc, journal, started, observation, *, clock=time.time):
    """Grant only the first awaiting-approval plan, with a durable send intent."""
    if clock() >= started['deadlineAtUnix']:
        return False
    if observation['taskPhase'] != 'awaiting-approval' or observation['everApproved']:
        return False
    if journal.read('approval-intent.json') is not None:
        return False
    def send(_):
        result = rpc.command(started['sessionId'], '/task approve')['result']
        if result['kind'] != 'success':
            raise RuntimeError('initial plan approval failed')
        return {'kind': 'success'}
    journal.mutate_once('approval', {'sessionId': started['sessionId'],
                                   'taskId': observation['taskId'],
                                   'planVersion': observation['planVersion']}, send)
    return True


def supervise(rpc, journal, read_projection, quiesce, *, approve_plan=None,
              clock=time.time, sleep=time.sleep, poll_sec=2, read_native_stop=None, stop_on_pause=False):
    """Observe the same attempt; never send a rescue.

    Legacy releases wait out pauses. An admitted termination policy can seal an
    idle manual-only pause or an evidenced native stop before the maximum window.

    quiesce must return only after the native Host and owned descendants stop;
    it may export the committed patch before sealing but must never commit it.
    A restarted monitor reads original intent/Session and sends no new start.
    """
    started = journal.read('started.json')
    if started is None:
        raise RuntimeError('no original attempt to monitor')
    terminal = journal.read('terminal.json')
    if terminal is not None:
        return terminal
    first_pause = journal.read('pause-observed.json')
    last = None
    with journal.controller():
        # A prior observer may seal after our first read but before this lock.
        terminal = journal.read('terminal.json')
        if terminal is not None:
            return terminal
        first_pause = journal.read('pause-observed.json')
        while True:
            now = clock()
            if now >= started['deadlineAtUnix']:
                status = 'deadline'
                break
            try:
                values = projection_values(read_projection(started['sessionId']))
                row = next(row for row in rpc.call('session/list')['items']
                           if row['sessionId'] == started['sessionId'])
                approved = journal.read('approval-receipt.json') is not None
                last = observe(started['condition'], values, row['running'], approved)
                if read_native_stop is not None and started['condition'] == 'goal' and last['idle'] and last['taskPhase'] == 'active':
                    evidence = read_native_stop(started['sessionId'], values)
                    # Reading compressed evidence does not lock native events.
                    # Recheck the whole projection and live running flag before
                    # acting on the stop; queued or resumed work invalidates it.
                    fresh = projection_values(read_projection(started['sessionId']))
                    row = next(row for row in rpc.call('session/list')['items']
                               if row['sessionId'] == started['sessionId'])
                    evidence = evidence if fresh == values else None
                    last = observe(started['condition'], fresh, row['running'], approved, evidence)
                if last['status'] in ('paused', 'internal-fault') and first_pause is None:
                    first_pause = journal.write('pause-observed.json', {
                        'atUnix': now, 'status': last['status'], 'taskPhase': last['taskPhase'],
                        'pauseReason': last['pauseReason'], 'rescueCount': 0})
                # Legacy releases wait out pauses; either policy sends no
                # retry-review/resume/prompt or second approval.
                if first_pause is None:
                    if started['condition'].startswith('supervisor-'):
                        approve_supervisor(rpc, journal, started, last, clock=clock)
                    elif started['condition'] == 'plan' and not approved and approve_plan is not None:
                        approve_plan(started, journal)
                if last['status'] in ('native-complete', 'native-blocked', 'controller-conflict', 'controller-off', 'native-stopped'):
                    status = last['status'] if first_pause is None else 'protocol-deviation'
                    break
                if stop_on_pause and last['status'] in ('paused', 'internal-fault') and last['idle']:
                    status = 'manual-intervention-required'
                    break
            except (OSError, ValueError, KeyError, StopIteration, RuntimeError) as error:
                # A transport failure is retained and does not reissue a mutation.
                journal.write(f'observation-error-{uuid.uuid4()}.json', {
                    'atUnix': now, 'errorType': type(error).__name__})
                status = 'deadline' if clock() >= started['deadlineAtUnix'] else 'infrastructure-fault'
                break
            sleep(min(poll_sec, max(0, started['deadlineAtUnix'] - clock())))
        ended = clock()
        cleanup = quiesce(started, last)
        result = {
            'schemaVersion': 1, 'id': started['id'], 'condition': started['condition'],
            'mainSessionId': started['sessionId'], 'sessionId': started['sessionId'],
            'status': status, 'nativeFinished': status == 'native-complete',
            'finishedBeforeDeadline': status == 'native-complete' and ended < started['deadlineAtUnix'],
            'endedAtUnix': ended, 'deadlineAtUnix': started['deadlineAtUnix'],
            'taskPhase': last['taskPhase'] if last else None,
            'pauseReason': last['pauseReason'] if last else None,
            'firstPause': first_pause, 'reviewFault': last['reviewFault'] if last else None,
            'nativeStop': last.get('nativeStop') if last else None,
            'controllerOwners': last['controllerOwners'] if last else [],
            'reviewJobs': last['reviewJobs'] if last else [],
            'approvalCount': int(journal.read('approval-receipt.json') is not None),
            'approvalUncertain': journal.read('approval-intent.json') is not None and journal.read('approval-receipt.json') is None,
            'rescueCount': 0, 'cleanupAcknowledged': cleanup['acknowledged'],
            'submissionDir': cleanup.get('submissionDir'), 'cutoff': cleanup.get('cutoff'),
        }
        if not cleanup['acknowledged']:
            result['executionStatus'] = status
            result['status'] = 'infrastructure-fault'
        return journal.write('terminal.json', result)
