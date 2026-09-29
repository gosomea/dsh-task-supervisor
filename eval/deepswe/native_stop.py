"""Bind native stop observations to admitted controller sources and Session events."""
import hashlib
from pathlib import Path
import re

from metrics import read_home


def admitted_goal_driver(runtime, policy):
    """The admission record pins the source whose max-token stop was verified."""
    expected = policy.get('goalDriverSha256')
    if not isinstance(expected, str) or re.fullmatch(r'[0-9a-f]{64}', expected) is None:
        raise ValueError('Native stop policy needs a verified Goal driver source hash')
    path = Path(runtime) / 'dsh-source/packages/goal/goal-round-driver/src/index.ts'
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise ValueError('Native stop policy differs from the admitted Goal driver')
    return actual


def goal_stop_evidence(events, values, driver_sha):
    """An idle active phase alone is insufficient: require the current final event."""
    current = (values.get('goal') or {}).get('current') or {}
    goal = current.get('goal') or {}
    stats, boundary, inbox = (values.get(key) or {} for key in ('sessionStats', 'turnBoundary', 'inbox'))
    if (goal.get('phase') != 'active' or not events
            or stats.get('openStep') is not None or stats.get('pendingCalls')
            or boundary.get('openTurnStartSeq') is not None
            or any(not isinstance(inbox.get(key), list) or inbox[key] for key in ('next-turn', 'next-step'))):
        return None
    event = events[-1]
    data = event.get('data') or {}
    if (event.get('type') != 'turn/end' or (data.get('reason') or {}).get('kind') != 'max-tokens'
            or data.get('turn') != stats.get('lastTurn') or data.get('turn') != boundary.get('lastTurn')):
        return None
    change = next((row for row in reversed(events) if row.get('type') == 'goal/change'), None)
    changed = ((change or {}).get('data') or {}).get('goal') or {}
    if (not goal.get('id') or not goal.get('revision')
            or any(changed.get(key) != goal[key] for key in ('id', 'revision'))):
        return None
    return {'kind': 'goal-round-driver-disarmed', 'reason': 'max-tokens',
            'turn': data['turn'], 'seq': event['seq'], 'nativeStoppedAtUnix': event['time'] / 1000,
            'goalId': goal['id'], 'goalRevision': goal['revision'], 'driverSourceSha256': driver_sha,
            'activationObservation': 'source-policy-inference-not-persisted-state'}


def read_goal_stop(home, session_id, values, driver_sha):
    sessions, _, hashes = read_home(Path(home))
    evidence = goal_stop_evidence(sessions.get(session_id, []), values, driver_sha)
    if evidence is not None:
        evidence['sessionEvidence'] = hashes
    return evidence


def admitted_plan_mode(runtime, policy):
    expected = policy.get('planModeSha256')
    if not isinstance(expected, str) or re.fullmatch(r'[0-9a-f]{64}', expected) is None:
        raise ValueError('Native Plan stop policy needs a verified Plan source hash')
    path = Path(runtime) / 'dsh-source/packages/plan/plan-mode/src/index.ts'
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise ValueError('Native Plan stop policy differs from the admitted source')
    return actual


def plan_stop_evidence(events, values, source_sha):
    """A Plan mode flag cannot resume an ended, unqueued max-token turn."""
    plan = values.get('plan') or {}
    stats, boundary, inbox = (values.get(key) or {} for key in ('sessionStats', 'turnBoundary', 'inbox'))
    if (type(plan.get('active')) is not bool or plan.get('pending') not in (None, False)
            or plan.get('wanted') is not None or plan.get('running') is not None
            or not events or stats.get('openStep') is not None or stats.get('pendingCalls')
            or boundary.get('openTurnStartSeq') is not None
            or any(not isinstance(inbox.get(key), list) or inbox[key] for key in ('next-turn', 'next-step'))):
        return None
    event = events[-1]
    data = event.get('data') or {}
    if (event.get('type') != 'turn/end' or (data.get('reason') or {}).get('kind') != 'max-tokens'
            or type(data.get('turn')) is not int
            or data['turn'] != stats.get('lastTurn') or data['turn'] != boundary.get('lastTurn')):
        return None
    change = next((row for row in reversed(events) if row.get('type') == 'plan/mode'), None)
    if change is None or (change.get('data') or {}).get('active') is not plan['active']:
        return None
    return {'kind': 'plan-mode-no-continuation', 'reason': 'max-tokens',
            'turn': data['turn'], 'seq': event['seq'], 'nativeStoppedAtUnix': event['time'] / 1000,
            'planModeSeq': change['seq'], 'planModeActive': plan['active'],
            'driverSourceSha256': source_sha,
            'activationObservation': 'no-auto-continuation-source-policy'}


def read_plan_stop(home, session_id, values, source_sha):
    sessions, _, hashes = read_home(Path(home))
    evidence = plan_stop_evidence(sessions.get(session_id, []), values, source_sha)
    if evidence is not None:
        evidence['sessionEvidence'] = hashes
    return evidence
