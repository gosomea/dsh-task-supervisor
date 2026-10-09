"""Report-only trajectory counts from the original collected native logs."""
from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from session_records import control_event

REVIEW_KINDS = ('planning', 'plan', 'progress', 'stage', 'completion')
NODE_STATUSES = ('pending', 'running', 'reviewing', 'passed', 'needs-revision',
                 'awaiting-user', 'awaiting-integration')


def summarize_trajectory(sessions, main_id, task_id=None):
    if main_id not in sessions:
        raise ValueError('original main Session is missing')
    linked = {main_id}
    while True:
        children = {sid for sid, events in sessions.items()
                    if events and events[0].get('parentSession') in linked}
        if children <= linked:
            break
        linked |= children
    tasks, jobs = {}, {}
    plan_versions = set()
    for stored in sessions[main_id][1:]:
        event = control_event(stored)
        data = event.get('data') or {}
        payload = data.get('payload')
        if event.get('type') != 'extension/record' or not isinstance(payload, dict):
            continue
        namespace, kind = data.get('namespace'), data.get('kind')
        if namespace == 'dsh-task-supervisor' and kind == 'state':
            tasks[payload['id']] = payload
            if payload['id'] == task_id and type(payload.get('planVersion')) is int:
                plan_versions.add(payload['planVersion'])
        elif namespace == 'dsh-task-supervisor-review' and kind == 'job':
            if payload.get('mainSessionId') == main_id:
                jobs[payload['id']] = payload
    reviewer_ids = {job.get('reviewerSessionId') for job in jobs.values()}
    rows = []
    for sid in sorted(linked):
        counts = Counter(event.get('type') for event in sessions[sid][1:])
        errors = sum(event.get('type') == 'tool/result'
                     and (event.get('data', {}).get('message') or {}).get('isError') is True
                     for event in sessions[sid][1:])
        rows.append({'sessionId': sid,
            'role': 'main' if sid == main_id else 'reviewer' if sid in reviewer_ids else 'child',
            'events': len(sessions[sid]) - 1,
            'turns': counts['turn/start'], 'modelSteps': counts['step/start'],
            'requestRetries': counts['llm/retry-started'],
            'toolCalls': counts['tool/call'], 'toolErrors': errors,
            'contextCompactions': counts['compaction/end']})
    task = tasks.get(task_id)
    task_counts = None
    if task is not None:
        runs = task.get('nodeRuns')
        statuses = Counter(run['status'] for run in runs or [] if run.get('status') in NODE_STATUSES)
        attempts = [run.get('attempt') for run in runs or []]
        valid_attempts = isinstance(runs, list) and all(type(value) is int and value > 0 for value in attempts)
        task_counts = {'declaredNodes': len(task.get('stages', [])),
            'observedPlanVersions': sorted(plan_versions),
            'currentNodeAttemptOrdinalsSum': sum(attempts) if valid_attempts else None,
            'maxCurrentNodeAttempt': max(attempts) if valid_attempts and attempts else None,
            'nodeStatuses': dict(statuses) if isinstance(runs, list) else None,
            'reviewJobsByKind': {kind: sum(job.get('taskId') == task_id and job.get('kind') == kind
                for job in jobs.values()) for kind in REVIEW_KINDS}}
    return {'basis': 'original-collected-native-session-events',
        'linkedSessions': len(rows), 'excludedUnrelatedSessions': len(sessions) - len(rows),
        'allTurns': sum(row['turns'] for row in rows),
        'allModelSteps': sum(row['modelSteps'] for row in rows),
        'allToolCalls': sum(row['toolCalls'] for row in rows),
        'allToolErrors': sum(row['toolErrors'] for row in rows),
        'allContextCompactions': sum(row['contextCompactions'] for row in rows),
        'sessions': rows, 'supervisorTask': task_counts,
        'nativeNodeComparison': 'native Goal and Plan do not share Supervisor node semantics'}


def read_trajectory(directory, main_id):
    directory = Path(directory)
    collection = json.loads((directory / 'collection.json').read_text())
    if collection['sessionId'] != main_id:
        raise ValueError('collection belongs to another Session')
    binding = directory / 'task-binding.json'
    task_id = json.loads(binding.read_text())['taskId'] if binding.exists() else None
    source = Path(__file__).resolve().parents[1] / 'deepswe/metrics.py'
    spec = importlib.util.spec_from_file_location('trajectory_native_reader', source)
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    sessions, _, hashes = reader.read_home(Path(collection['home']))
    value = summarize_trajectory(sessions, main_id, task_id)
    value['sessionEvidenceIndexSha256'] = hashlib.sha256(json.dumps(
        sorted(hashes, key=lambda row: row['relativePath']), sort_keys=True).encode()).hexdigest()
    return value
