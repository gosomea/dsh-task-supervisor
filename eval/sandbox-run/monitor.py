"""Deterministic observation and exactly-once protocol actions; never a model.

Transport loss leaves an intent pending. Reconciliation reads the same native
Task and never transmits that action again. All receipts are immutable.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import uuid

from records import exclusive_json
from native_fault import confirmed_fault

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from session_records import control_event

TASK_NS = 'dsh-task-supervisor'
REVIEW_NS = 'dsh-task-supervisor-review'
BUDGET_NS = 'dsh-task-supervisor-execution-budget'
PROTOCOL_NS = 'dsh-long-horizon-eval'
CONDITIONS = ('goal', 'plan', 'supervisor-independent')


class Journal:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def read(self, name):
        path = self.root / name
        return json.loads(path.read_text()) if path.exists() else None

    def write(self, name, row):
        exclusive_json(self.root / name, row)
        return row

    @contextmanager
    def owner(self):
        """The OS releases a crashed observer's lease; its intents remain."""
        with (self.root / 'monitor.lock').open('a') as stream:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise RuntimeError('another monitor owns this position') from error
            lease = self.write('leases/' + uuid.uuid4().hex + '.json', {
                'pid': os.getpid(), 'atUnix': time.time(), 'source': 'evaluation-protocol'})
            try:
                yield lease
            finally:
                fcntl.flock(stream, fcntl.LOCK_UN)


def parse_events(raw: bytes, expected_session_id=None) -> list[dict]:
    """Ignore only an incomplete final line; malformed durable lines fail."""
    lines = raw.splitlines(keepends=True)
    events = []
    for index, line in enumerate(lines):
        try:
            event = json.loads(line)
        except (ValueError, UnicodeDecodeError):
            if index == len(lines) - 1 and not line.endswith(b'\n'):
                break
            raise ValueError('malformed persisted Session event') from None
        if index == 0 and isinstance(event, dict) and event.get('type') == 'session':
            if not isinstance(event.get('id'), str) or type(event.get('version')) is not int:
                raise ValueError('invalid native Session header')
            if expected_session_id and event['id'] != expected_session_id:
                raise ValueError('native Session header belongs to another position')
            continue
        if index == 0 and expected_session_id:
            raise ValueError('missing native Session header')
        if not isinstance(event, dict) or type(event.get('seq')) is not int or not isinstance(event.get('type'), str):
            raise ValueError('invalid native event envelope')
        if events and event['seq'] <= events[-1]['seq']:
            raise ValueError('non-monotonic Session events')
        events.append(control_event(event))
    return events


def fold(events):
    """Read only formal native carriers, never arbitrary nested JSON."""
    tasks, jobs, budgets, barriers, questions = {}, {}, {}, [], {}
    for event in events:
        if event['type'] != 'extension/record':
            continue
        data = event.get('data') or {}
        payload = data.get('payload')
        if not isinstance(payload, dict):
            continue
        target = None
        namespace, kind = data.get('namespace'), data.get('kind')
        if namespace == TASK_NS and kind == 'state':
            target, identity = tasks, payload.get('id')
        elif namespace == REVIEW_NS and kind == 'job':
            target, identity = jobs, payload.get('id')
        elif namespace == BUDGET_NS and kind == 'state':
            target, identity = budgets, payload.get('taskId')
        elif namespace == PROTOCOL_NS and kind == 'revision-barrier':
            barriers.append({**payload, 'seq': event['seq']})
        elif namespace == PROTOCOL_NS and kind == 'question':
            target, identity = questions, payload.get('id')
        if target is not None:
            if not identity or type(payload.get('revision')) is not int:
                raise ValueError('missing control identity or revision')
            old = target.get(identity)
            if old and payload['revision'] <= old['revision']:
                # Duplicate same-job observations are not multiple reviews.
                if payload == old:
                    continue
                raise ValueError('control revision went backwards or changed')
            target[identity] = payload
    return {'tasks': tasks, 'jobs': jobs, 'budgets': budgets, 'barriers': barriers, 'questions': questions}


def applied_plan(task, jobs, session_id):
    if not task or task.get('phase') != 'awaiting-approval' or not task.get('enabled'):
        return None
    for job in reversed(list(jobs.values()) if isinstance(jobs, dict) else jobs):
        original = job.get('input') or {}
        if (job.get('status') == 'applied' and job.get('kind') == 'plan'
                and job.get('stageId') == 'plan' and not job.get('fault')
                and job.get('mainSessionId') == session_id and job.get('taskId') == task['id']
                and original.get('id') == task['id']
                and original.get('requirementsVersion') == task.get('requirementsVersion')
                and job.get('planVersion') == original.get('planVersion')
                and task.get('planVersion') == original.get('planVersion', -2) + 1
                and (job.get('decision') or {}).get('verdict') == 'pass'):
            return job
    return None


def action_once(journal, name, payload, send, *, clock=time.time):
    """Reserved before sending; transport exceptions are retained, not retried."""
    if journal.read('actions/' + name + '-intent.json'):
        return False
    intent = journal.write('actions/' + name + '-intent.json', {
        'schemaVersion': 1, 'source': 'evaluation-protocol', 'action': name,
        'actionId': str(uuid.uuid4()), 'atUnix': clock(), **payload})
    try:
        send(intent)
    except Exception as error:
        journal.write('actions/' + name + '-transport-fault.json', {
            'actionId': intent['actionId'], 'errorType': type(error).__name__,
            'atUnix': clock(), 'resultUnknown': True, 'retransmissionAllowed': False})
    # Application is proved separately from the native record, even when the
    # HTTP response succeeded. A successful enqueue is not an applied permit.
    return True


def reconcile_action(journal, name, task, *, clock=time.time):
    intent = journal.read('actions/' + name + '-intent.json')
    if not intent or journal.read('actions/' + name + '-receipt.json'):
        return False
    if not task or task.get('id') != intent['taskId']:
        return False
    if name == 'revision':
        proved = (task.get('requirementsVersion') == intent['requirementsVersion'] + 1
                  and task.get('objective') == intent['objective'])
    else:
        approval = task.get('lastApproval') or {}
        proved = (task.get('requirementsVersion') == intent['requirementsVersion']
                  and task.get('everApproved') is True
                  and approval.get('planVersion') == intent['planVersion']
                  and task.get('revision', 0) > intent['revision'])
    if not proved:
        return False
    journal.write('actions/' + name + '-receipt.json', {
        'schemaVersion': 1, 'source': 'evaluation-protocol', 'actionId': intent['actionId'],
        'atUnix': clock(), 'reconciledFromNativeState': True, 'taskId': task['id'],
        'requirementsVersion': task['requirementsVersion'], 'revision': task['revision']})
    return True


def protocol_actions(journal, started, view, send, *, revision=None, clock=time.time):
    """Only one initial grant and the exact optional development amendment."""
    task = view.get('task')
    if not task or clock() >= started['deadlineAtUnix']:
        return
    if task.get('mainSessionId', started['sessionId']) != started['sessionId']:
        raise ValueError('Task belongs to another Session')
    binding = journal.read('task-binding.json')
    if binding and binding['taskId'] != task['id']:
        raise ValueError('Task identity changed during a fixed position')
    if not binding:
        actual_hash = hashlib.sha256(task['objective'].encode()).hexdigest()
        if started.get('instructionSha256') and actual_hash != started['instructionSha256']:
            raise ValueError('Task objective differs from the frozen original instruction')
        journal.write('task-binding.json', {'taskId': task['id'], 'sessionId': started['sessionId'],
            'requirementsVersion': task['requirementsVersion'], 'objectiveSha256': actual_hash})
        binding = journal.read('task-binding.json')
    for name in ('initial-approval', 'revision', 'revision-approval'):
        reconcile_action(journal, name, task, clock=clock)
    expected = binding['requirementsVersion']
    if task['requirementsVersion'] != expected:
        revised = journal.read('actions/revision-receipt.json')
        intent = journal.read('actions/revision-intent.json')
        if not revision or not revised or not intent or task['requirementsVersion'] != expected + 1 or task['objective'] != revision['objective']:
            raise ValueError('unexpected requirement change; no additional authorization')
    common = {key: task[key] for key in ('revision', 'requirementsVersion', 'planVersion')}
    common.update(taskId=task['id'], sessionId=started['sessionId'])
    job = applied_plan(task, view['jobs'], started['sessionId'])
    if task['requirementsVersion'] == expected and job and view.get('idle'):
        action_once(journal, 'initial-approval', {**common, 'reviewJobId': job['id']}, send, clock=clock)
    if not revision:
        return
    if hashlib.sha256(revision['objective'].encode()).hexdigest() != revision['sha256']:
        raise ValueError('revision text differs from frozen preauthorization')
    barrier = next((row for row in view.get('barriers', []) if row.get('taskId') == task['id']
                   and row.get('requirementsVersion') == expected and row.get('initialSha256') == binding['objectiveSha256']
                   and row.get('revisionSha256') == revision['sha256']), None)
    if task['requirementsVersion'] == expected and barrier and journal.read('actions/initial-approval-receipt.json'):
        if barrier.get('nodeAttempt') != 1 or barrier.get('nextNodeStarted') is not False:
            raise ValueError('revision barrier outside frozen first-node trigger')
        action_once(journal, 'revision', {**common, 'objective': revision['objective'],
            'revisionSha256': revision['sha256'], 'barrierSeq': barrier['seq']}, send, clock=clock)
    elif task['requirementsVersion'] == expected + 1 and job and view.get('idle'):
        action_once(journal, 'revision-approval', {**common, 'reviewJobId': job['id']}, send, clock=clock)


def terminal_reason(view, started, now):
    if now >= started['deadlineAtUnix']:
        return 'deadline'
    if view.get('hostExited'):
        return 'execution-side-exit'
    if view.get('storageExceeded'):
        return 'storage-limit'
    if view.get('questions'):
        return 'user-decision'
    task = view.get('task')
    if task:
        if task.get('phase') == 'complete':
            return 'controller-complete' if view.get('idle') else None
        if not task.get('enabled') or task.get('phase') == 'cleared':
            return 'controller-off'
        if task.get('phase') == 'paused':
            reason = task.get('pauseReason')
            return {'task-deadline': 'deadline', 'execution-budget': 'recovery-budget',
                    'review-fault': 'internal-review-fault', 'user': 'user-pause',
                    'needs-user': 'user-decision', 'decision': 'user-decision',
                    'planning-stalled': 'planning-stalled', 'recovery-stalled': 'recovery-stalled',
                    'restart': 'host-restart'}.get(reason, 'native-pause')
    return view.get('nativeTerminal')


def renew(runtime, box, info, started, *, clock=time.time):
    expiry = datetime.fromisoformat(info['expires_at'].replace('Z', '+00:00')).timestamp()
    if expiry - clock() < 900:
        # Collection window is fixed; never changes the original task deadline.
        until = datetime.fromtimestamp(started['deadlineAtUnix'] + 600, timezone.utc)
        if until.timestamp() > clock():
            runtime.renew_until(box, until)
            return until.isoformat()
    return None


def observe(journal, started, reader, send, quiesce, *, revision=None, tick=60,
            clock=time.time, sleep=time.sleep, keepalive=None, max_ticks=None):
    """Reconnect to original state, not start an Agent. May yield after a tick."""
    with journal.owner():
        previous = journal.read('terminal.json')
        if previous:
            return previous
        ticks = 0
        while True:
            now = clock()
            view, reason = None, None
            try:
                if now >= started['deadlineAtUnix']:
                    reason = 'deadline'
                else:
                    if keepalive:
                        keepalive()
                    view = reader(started)
                    now = clock()
                    reason = terminal_reason(view, started, now)
                    fault_pending = bool(view.get('nativeRequestFault'))
                    if fault_pending and reason == 'controller-complete':
                        # A current settled request failure outranks an earlier
                        # response; still allow the normal two-observation wait.
                        reason = None
                    if not reason and confirmed_fault(journal, view.get('nativeRequestFault'), now):
                        reason = 'native-upstream-fault'
                    if started['condition'] == 'plan':
                        intent = journal.read('actions/initial-approval-intent.json')
                        grant = view.get('nativePlanGrant') or {}
                        if intent and view.get('nativePlanApplied') and grant.get('actionId') == intent['actionId'] and not journal.read('actions/initial-approval-receipt.json'):
                            journal.write('actions/initial-approval-receipt.json', {'source': 'evaluation-protocol',
                                'actionId': intent['actionId'], 'questionId': intent['questionId'], 'sessionId': started['sessionId'],
                                'atUnix': clock(), 'transport': 'native-user-questions', 'reconciledFromNativeState': True})
                        if intent and view.get('planApprovalReady') and intent.get('questionId') != view['planApprovalReady']['questionId']:
                            reason = 'user-decision'
                    if not reason and not fault_pending and started['condition'] == 'supervisor-independent':
                        protocol_actions(journal, started, view, send, revision=revision, clock=clock)
                    elif not reason and not fault_pending and started['condition'] == 'plan' and view.get('planApprovalReady'):
                        action_once(journal, 'initial-approval', view['planApprovalReady'], send, clock=clock)
            except Exception as error:
                journal.write('faults/' + uuid.uuid4().hex + '.json', {'atUnix': now,
                    'errorType': type(error).__name__, 'source': 'deterministic-monitor'})
                reason = 'infrastructure-fault'
            journal.write('observations/' + uuid.uuid4().hex + '.json', {
                'atUnix': now, 'reason': reason, 'taskId': ((view or {}).get('task') or {}).get('id'),
                'phase': ((view or {}).get('task') or {}).get('phase') or ((view or {}).get('nativeState') or {}).get('taskPhase'),
                'nativeRequestFault': (view or {}).get('nativeRequestFault'),
                'budget': (view or {}).get('budget'), 'resources': (view or {}).get('resources'), 'rescueCount': 0})
            if reason:
                try:
                    cleanup = quiesce(started, view)
                except Exception as error:
                    cleanup = {'acknowledged': False, 'faults': [type(error).__name__]}
                completion = cleanup.get('completionEvidence')
                completed = reason == 'controller-complete' or bool(reason == 'deadline' and completion
                    and completion['atUnix'] <= started['deadlineAtUnix'])
                return journal.write('terminal.json', {'schemaVersion': 1, 'id': started['id'],
                    'sessionId': started['sessionId'], 'condition': started['condition'],
                    'firstStopReason': reason, 'atUnix': clock(), 'deadlineAtUnix': started['deadlineAtUnix'],
                    'controllerComplete': completed,
                    'finishedBeforeDeadline': completed and (bool(completion) or now < started['deadlineAtUnix']),
                    'completionEvidence': completion,
                    'infrastructureFault': reason in ('infrastructure-fault', 'sandbox-lost', 'execution-side-exit', 'storage-limit', 'native-upstream-fault') or not cleanup['acknowledged'],
                    'requestFaultEvidence': (view or {}).get('nativeRequestFault'),
                    'nativeCompletionEvidence': (view or {}).get('nativeCompletionEvidence'),
                    'cleanup': cleanup, 'rescueCount': 0})
            ticks += 1
            if max_ticks is not None and ticks >= max_ticks:
                return {'pending': True, 'sessionId': started['sessionId']}
            sleep(min(tick, max(0, started['deadlineAtUnix'] - clock())))
