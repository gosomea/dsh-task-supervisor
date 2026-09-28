#!/usr/bin/env python3
"""Audit native review history; labels and external outcomes are never inferred."""
import argparse
from collections import Counter
from datetime import datetime
import json
from pathlib import Path


def summarize(events, labels=None):
    labels = labels or {}
    histories = {}
    fault_pauses = set()
    for event in events:
        if event.get('type') != 'extension/record':
            continue
        data = event['data']
        if data.get('namespace') == 'dsh-task-supervisor-review':
            job = data['payload']
            histories.setdefault(job['id'], []).append(job)
        if data.get('namespace') == 'dsh-task-supervisor' and data.get('kind') == 'state':
            task = data['payload']
            if task.get('pauseReason') == 'review-fault':
                fault_pauses.add(task.get('reviewFault', {}).get('jobId'))
    final = [rows[-1] for rows in histories.values()]
    faults = Counter()
    missing = recovered = exhausted = repairs = retries = 0
    wait_ms = 0
    measured_windows = unfinished_windows = 0
    sessions = set()
    policy_counts = Counter()
    for rows in histories.values():
        seen_faults = {row['fault']['code'] for row in rows if row.get('fault')}
        faults.update(seen_faults)
        missing += 'protocol-missing' in seen_faults
        repaired = [row for row in rows if row['status'] == 'repairing']
        repairs += len(repaired)
        decision = any(row.get('decision') for row in rows)
        recovered += bool(repaired and decision)
        exhausted += bool(repaired and not decision and rows[-1]['status'] == 'failed')
        windows = {}
        for row in rows:
            windows[row['runtimeId']] = row
            if row.get('reviewerSessionId'):
                sessions.add(row['reviewerSessionId'])
        retries += max(0, len(windows) - 1)
        for row in windows.values():
            if not row.get('finishedAt'):
                unfinished_windows += 1
                continue
            start = row.get('attemptStartedAt')
            if start is None:
                # Old records have no per-recovery start; don't invent timing.
                unfinished_windows += 1
                continue
            elapsed = (datetime.fromisoformat(row['finishedAt']) - datetime.fromisoformat(start)).total_seconds() * 1000
            wait_ms += max(0, elapsed)
            measured_windows += 1
        settings = rows[0].get('observationSettings')
        policy_counts[json.dumps(settings, sort_keys=True) if settings else 'unrecorded'] += 1
    labelled = [(job, labels[job['id']]) for job in final if job['id'] in labels]
    false_pause_denominator = [(job, label) for job, label in labelled if label.get('drift') is False]
    false_pauses = sum((job.get('decision') or {}).get('verdict') == 'needs-user' for job, _ in false_pause_denominator)
    return {
        'schemaVersion': 1, 'kind': 'review-recovery-audit', 'jobs': len(final),
        'checksByKind': dict(Counter(row['kind'] for row in final)),
        'faultsByCode': dict(faults), 'protocolMissingJobs': missing,
        'protocolMissingRate': missing / len(final) if final else None,
        'repairTurns': repairs, 'jobsRecoveredAfterRepair': recovered,
        'jobsWithRepair': sum(any(row['status'] == 'repairing' for row in rows) for rows in histories.values()),
        'jobsExhaustedAfterRepair': exhausted, 'manualRecoveryWindows': retries,
        'faultPauseJobs': len(fault_pauses - {None}),
        'effectiveNeedsUserJobs': sum(bool(row.get('decision')) and row['decision']['verdict'] == 'needs-user' and row['status'] == 'applied' for row in final),
        'reviewWaitMs': wait_ms if measured_windows else None,
        'measuredWindows': measured_windows, 'unmeasuredOrUnfinishedWindows': unfinished_windows,
        'reviewerSessionIds': sorted(sessions), 'settings': dict(policy_counts),
        'labelledJobs': len(labelled),
        'falsePauseRate': false_pauses / len(false_pause_denominator) if false_pause_denominator else None,
        'correctionsConfirmed': sum(label.get('correctionEffective') is True for _, label in labelled) if labelled else None,
        'limitations': ['External task success and reward require independent grading.',
                        'All-session tokens require native token usage from main, review, worker and consultation Sessions.',
                        'No labels means correction quality, false pauses and missed drift remain unmeasured.'],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('log', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--labels', type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Refusing to overwrite an audit result')
    events = [json.loads(line) for line in args.log.read_text().splitlines() if line.strip()]
    result = summarize(events, json.loads(args.labels.read_text()) if args.labels else None)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'jobs': result['jobs'], 'output': str(args.output)}))


if __name__ == '__main__':
    main()
