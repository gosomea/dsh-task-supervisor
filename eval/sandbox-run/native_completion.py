"""Bind native Plan completion to its latest completed turn and empty queues."""
import re


def plan_completion_evidence(events, values, source_sha):
    if not isinstance(source_sha, str) or not re.fullmatch('[a-f0-9]{64}', source_sha):
        return None
    plan = values.get('plan') or {}
    stats, boundary, inbox = (values.get(key) or {} for key in ('sessionStats', 'turnBoundary', 'inbox'))
    if (plan.get('active') is not False or plan.get('pending') not in (None, False)
            or plan.get('wanted') is not None or plan.get('running') is not None
            or 'openStep' not in stats or stats['openStep'] is not None
            or not isinstance(stats.get('pendingCalls'), (dict, list)) or stats['pendingCalls']
            or 'openTurnStartSeq' not in boundary or boundary['openTurnStartSeq'] is not None
            or any(not isinstance(inbox.get(key), list) or inbox[key] for key in ('next-turn', 'next-step'))
            or not events):
        return None
    event = events[-1]
    data = event.get('data') or {}
    if (event.get('type') != 'turn/end' or (data.get('reason') or {}).get('kind') != 'completed'
            or type(data.get('turn')) is not int
            or data['turn'] != stats.get('lastTurn') or data['turn'] != boundary.get('lastTurn')):
        return None
    return {'kind': 'native-plan-turn-completed', 'seq': event['seq'], 'turn': data['turn'],
            'nativeStoppedAtUnix': event['time'] / 1000,
            'controllerSourceSha256': source_sha, 'basis': 'completed-current-turn-and-empty-queues'}
