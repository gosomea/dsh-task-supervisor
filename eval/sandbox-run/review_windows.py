"""Observed durable review windows; not CPU time or inferred main-Agent blocking."""
from collections import defaultdict
import math
import re

KINDS = ('planning', 'plan', 'progress', 'stage', 'completion')
STATUSES = ('queued', 'repairing', 'started', 'submitted', 'failed', 'applied', 'stale')


def timestamp(event):
    value = event.get('time')
    return value if type(value) in (int, float) and math.isfinite(value) and value >= 0 else None


def identity(value):
    return value if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', value) else None


def window(start, end):
    left, right = timestamp(start), timestamp(end)
    return (left, right) if left is not None and right is not None and right >= left else None


def union_ms(windows):
    total, end = 0, None
    for left, right in sorted(windows):
        if end is None:
            total += right - left
        elif right > end:
            total += right - max(left, end)
        end = max(end, right) if end is not None else right
    return total


def summarize_review_windows(records, main_id, task_id):
    histories = defaultdict(list)
    for event, job in records:
        if job.get('mainSessionId') == main_id and job.get('taskId') == task_id:
            histories[job['id']].append((event, job))
    rows, intervals = [], []
    for history in histories.values():
        last = history[-1][1]
        # A failed attempt followed by a retry is not the end of this job.
        terminal = {}
        if last.get('status') in ('failed', 'applied', 'stale'):
            for event, job in reversed(history):
                if job.get('status') != last.get('status') or job.get('attempt') != last.get('attempt'):
                    break
                terminal = event
        first = history[0][0] if history[0][1].get('status') in ('queued', 'started', 'repairing') else {}
        started = next((event for event, job in history if job.get('status') == 'started'), {})
        observed, active = window(first, terminal), window(started, terminal)
        if observed is not None:
            intervals.append(observed)
        attempts = {job['attempt'] for _, job in history if type(job.get('attempt')) is int and job['attempt'] > 0}
        rows.append({'jobId': identity(last.get('id')),
            'kind': last.get('kind') if last.get('kind') in KINDS else 'unclassified',
            'finalStatus': last.get('status') if last.get('status') in STATUSES else 'unclassified',
            'observedReviewAttempts': len(attempts) if attempts else None,
            'firstRecordSeq': first.get('seq') if type(first.get('seq')) is int and first['seq'] >= 0 else None,
            'terminalRecordSeq': terminal.get('seq') if type(terminal.get('seq')) is int and terminal['seq'] >= 0 else None,
            'observedJobWindowMs': observed[1] - observed[0] if observed is not None else None,
            'observedStartedWindowMs': active[1] - active[0] if active is not None else None})
    known = len(intervals) == len(rows)
    by_kind = {}
    for kind in KINDS + ('unclassified',):
        selected = [row for row in rows if row['kind'] == kind]
        values = [row['observedJobWindowMs'] for row in selected]
        by_kind[kind] = {'jobs': len(selected), 'unknownWindows': sum(value is None for value in values),
            'totalObservedJobWindowMs': sum(values) if all(value is not None for value in values) else None}
    return {'basis': 'first durable job record to terminal record of final attempt; includes retries and queue delays',
        'interpretation': 'observed windows, not CPU time or proof that the main Agent was blocked throughout',
        'jobs': rows, 'unknownWindows': len(rows) - len(intervals),
        'totalObservedJobWindowMs': sum(right - left for left, right in intervals) if known else None,
        'observedUnionWindowMs': union_ms(intervals) if known else None, 'byKind': by_kind}
