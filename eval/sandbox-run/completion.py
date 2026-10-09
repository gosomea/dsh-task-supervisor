"""Completion proofs from settled native records, including the last polling gap."""
from datetime import datetime

from monitor import fold


def completion_evidence(events, values, started):
    """Stopping at the deadline must not erase an earlier durable completion.

    Called after quiescence. It authorizes nothing and does not infer success
    from an idle process, an Agent claim, or a partial final response.
    """
    deadline = started['deadlineAtUnix']
    condition = started['condition']
    if condition == 'supervisor-independent':
        state = fold(events)
        candidates = [task for task in state['tasks'].values() if task.get('phase') == 'complete']
        if len(candidates) != 1:
            return None
        task = candidates[0]
        review = task.get('lastReview') or {}
        job = state['jobs'].get(review.get('jobId')) or {}
        if (job.get('status') != 'applied' or job.get('kind') != 'completion'
                or job.get('taskId') != task['id'] or job.get('mainSessionId') != started['sessionId']
                or (job.get('decision') or {}).get('verdict') != 'pass'
                or (job.get('input') or {}).get('requirementsVersion') != task.get('requirementsVersion')):
            return None
        row = next((event for event in reversed(events) if event.get('type') == 'extension/record'
            and event.get('data', {}).get('namespace') == 'dsh-task-supervisor'
            and event['data'].get('payload') == task), None)
        try:
            at = datetime.fromisoformat(task['completedAt'].replace('Z', '+00:00')).timestamp()
        except (KeyError, ValueError, TypeError):
            return None
        if not row or not isinstance(row.get('time'), (float, int)) or max(at, row['time'] / 1000) > deadline:
            return None
        return {'condition': condition, 'taskId': task['id'], 'reviewJobId': job['id'],
            'seq': row['seq'], 'atUnix': max(at, row['time'] / 1000), 'source': 'settled-native-record'}
    from control_flow import observe
    if observe(condition, values, False, True)['status'] != 'native-complete':
        return None
    end = next((event for event in reversed(events) if event.get('type') == 'turn/end'), None)
    if not end or (end.get('data', {}).get('reason') or {}).get('kind') != 'completed' or end['time'] / 1000 > deadline:
        return None
    return {'condition': condition, 'seq': end['seq'], 'atUnix': end['time'] / 1000,
        'source': 'settled-native-record'}
