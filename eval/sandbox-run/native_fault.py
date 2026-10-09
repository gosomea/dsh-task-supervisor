"""Recognize settled upstream failures without interrupting native recovery."""
import re

REQUEST_CODES = frozenset(('TRANSPORT', 'TIMEOUT', 'SERVER', 'RATE_LIMIT', 'AUTH'))


def native_request_fault(events, values, condition, source_sha):
    # Supervisor recovery belongs to the plugin. Its explicit pause/decision
    # remains authoritative; this predicate does not compete with review jobs.
    if (condition not in ('goal', 'plan') or not events
            or not re.fullmatch('[a-f0-9]{64}', source_sha)):
        return None
    stats = values.get('sessionStats') or {}
    boundary = values.get('turnBoundary') or {}
    inbox = values.get('inbox') or {}
    if ('openStep' not in stats or stats['openStep'] is not None
            or stats.get('pendingCalls') or boundary.get('openTurnStartSeq') is not None
            or any(not isinstance(inbox.get(key), list) or inbox[key]
                   for key in ('next-turn', 'next-step'))):
        return None
    end = events[-1]
    data = end.get('data') or {}
    reason = data.get('reason') or {}
    failure = reason.get('error') or {}
    if (end.get('type') != 'turn/end' or reason.get('kind') != 'error'
            or failure.get('code') not in REQUEST_CODES or type(data.get('turn')) is not int
            or data['turn'] != stats.get('lastTurn') or data['turn'] != boundary.get('lastTurn')
            or not isinstance(end.get('time'), (int, float))):
        return None
    if condition == 'plan':
        plan = values.get('plan') or {}
        if (type(plan.get('active')) is not bool or plan.get('pending') not in (None, False)
                or plan.get('wanted') is not None or plan.get('running') is not None):
            return None
    else:
        goal = ((values.get('goal') or {}).get('current') or {}).get('goal') or {}
        if goal.get('phase') != 'active' or not goal.get('id'):
            return None
    return {'kind': 'settled-native-request-fault', 'condition': condition,
            'seq': end['seq'], 'turn': data['turn'], 'errorCode': failure['code'],
            'nativeStoppedAtUnix': end['time'] / 1000, 'controllerSourceSha256': source_sha,
            'basis': 'native-turn-error-and-empty-queues'}


def confirmed_fault(journal, proof, now, *, interval_sec=60):
    """A second unchanged observation allows native callbacks to settle first."""
    if not proof:
        return None
    path = f"native-request-faults/{proof['seq']}-{proof['turn']}.json"
    original = journal.read(path)
    if original is None:
        journal.write(path, {'firstObservedAtUnix': now, 'proof': proof})
        return None
    if original['proof'] != proof:
        raise ValueError('same native fault identity changed')
    return proof if now - original['firstObservedAtUnix'] >= interval_sec else None
